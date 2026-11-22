[CmdletBinding()]
param(
    # Without this switch the script performs preflight/duplicate checks and prints a plan only.
    [switch]$ConfirmCreate,
    [string]$Repository = 'OOO-Vector/Diplom'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Run from the repository root. The register supplies the authoritative task metadata;
# descriptions, scope and acceptance detail below are based on Product_Backlog.md/SRS.
$repoRoot = (Get-Location).Path
$script:completed = [System.Collections.Generic.List[object]]::new()
$script:issueByTaskId = @{}
$script:existingLabelNames = @()

function Invoke-Gh {
    param([Parameter(Mandatory)][string[]]$GhArgs)

    $output = & gh @GhArgs 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $rendered = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
        throw "gh $($GhArgs -join ' ') failed (exit code $exitCode). Output: $rendered"
    }
    return $output
}

function Resolve-SourceFile {
    param([Parameter(Mandatory)][string]$Name)

    $known = @(
        (Join-Path $repoRoot $Name),
        (Join-Path $repoRoot (Join-Path 'docs/planning' $Name)),
        (Join-Path $repoRoot (Join-Path 'docs' $Name))
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique

    if ($known.Count -eq 1) { return (Resolve-Path -LiteralPath $known[0]).Path }
    if ($known.Count -gt 1) {
        throw "Found multiple candidate source files named '$Name': $($known -join ', '). Keep one authoritative copy or specify the repository layout before running."
    }

    $found = @(Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Filter $Name -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|target|build|dist)[\\/]' })
    if ($found.Count -ne 1) {
        throw "Expected exactly one '$Name' under '$repoRoot'; found $($found.Count). Place the authoritative source at the repository root or docs/planning/."
    }
    return $found[0].FullName
}

function Get-AllIssues {
    $raw = (Invoke-Gh -GhArgs @('issue', 'list', '--repo', $Repository, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,url,state')) -join "`n"
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @($raw | ConvertFrom-Json)
}

function Find-TaskIssue {
    param(
        [Parameter(Mandatory)][object[]]$Issues,
        [Parameter(Mandatory)][string]$TaskId
    )

    $escaped = [regex]::Escape($TaskId)
    $titleRegex = "^\s*\[$escaped\](?:\s|$)"
    $bodyRegex = "(?im)^\s*(?:[-*]\s*)?(?:Original task ID|Task ID)\s*:\s*`?\s*$escaped\s*`?\s*$"
    $matches = @($Issues | Where-Object {
        ($_.title -match $titleRegex) -or (([string]$_.body) -match $bodyRegex)
    })

    if ($matches.Count -gt 1) {
        throw "Found $($matches.Count) Issues matching task ID '$TaskId'; refusing to create a duplicate or choose ambiguously."
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    return $null
}

function Get-ExistingLabelsForTask {
    param([Parameter(Mandatory)][object]$Task)

    $available = @{}
    foreach ($name in $script:existingLabelNames) { $available[$name.ToLowerInvariant()] = $name }

    $moduleCandidates = switch -Regex ($Task.Id) {
        '^SET-'  { @('tech', 'testing', 'ci'); break }
        '^DB-'   { @('database', 'db'); break }
        '^CORE-' { @('core', 'backend', 'auth', 'security'); break }
        '^PLAN-' { @('planning', 'plan'); break }
        default  { @() }
    }

    $selected = [System.Collections.Generic.List[string]]::new()
    foreach ($candidate in $moduleCandidates) {
        if ($available.ContainsKey($candidate.ToLowerInvariant())) {
            $selected.Add($available[$candidate.ToLowerInvariant()])
            break
        }
    }

    $priorityCandidates = @("priority:$($Task.Priority)", "priority: $($Task.Priority)", $Task.Priority, 'medium')
    foreach ($candidate in $priorityCandidates) {
        if ($available.ContainsKey($candidate.ToLowerInvariant())) {
            $selected.Add($available[$candidate.ToLowerInvariant()])
            break
        }
    }

    # Generic fallback only when that label already exists in the repository.
    if ($selected.Count -eq 0 -and $available.ContainsKey('enhancement')) {
        $selected.Add($available['enhancement'])
    }
    return @($selected | Select-Object -Unique)
}

function Format-DependencyLines {
    param([Parameter(Mandatory)][object]$Task)

    $dependencyIds = @()
    $rawDepends = [string]$Task.Registry.depends
    if (-not [string]::IsNullOrWhiteSpace($rawDepends) -and $rawDepends.Trim() -notin @('-', '—', '–')) {
        $dependencyIds = @($rawDepends -split '\s*,\s*' | Where-Object { $_ })
    }

    if ($dependencyIds.Count -eq 0) { return @('- None (`—` in the register).') }

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($dependencyId in $dependencyIds) {
        if ($dependencyId -eq 'DB-00') {
            $lines.Add('- `DB-00` — historical prerequisite only; no GitHub Issue is created or linked for it.')
        }
        elseif ($script:issueByTaskId.ContainsKey($dependencyId)) {
            $dependency = $script:issueByTaskId[$dependencyId]
            $lines.Add("- ``$dependencyId`` → [#$($dependency.number)]($($dependency.url))")
        }
        else {
            # Keep dependencies outside this selected scope as text; do not invent issue numbers.
            $lines.Add("- ``$dependencyId`` (outside this import scope; unresolved GitHub Issue reference).")
        }
    }
    return @($lines)
}

function New-IssueBody {
    param([Parameter(Mandatory)][object]$Task)

    $registry = $Task.Registry
    $acceptance = @($Task.Acceptance)
    $criteria = ($acceptance | ForEach-Object { "- [ ] $_" }) -join "`n"
    $scope = ($Task.Scope | ForEach-Object { "- $_" }) -join "`n"
    $trace = [string]$registry.trace
    $dependencyLines = (Format-DependencyLines -Task $Task) -join "`n"

    return @"
## Task metadata
- **Original task ID:** $($Task.Id)
- **Original title:** $($registry.title)
- **Workstream / epic:** $($registry.epic)
- **Status in register:** $($registry.status)
- **Priority:** $($registry.priority)
- **Estimate:** $($registry.estimate)
- **Responsible owner:** $($registry.owner)

## Description and implementation scope
$scope

## Requirements traceability
$trace

## Dependencies
$dependencyLines

## Acceptance criteria
$criteria

## Definition of Done
- [ ] Acceptance criteria above are implemented and demonstrated with evidence; no planned result is reported as already achieved.
- [ ] Relevant automated tests, including negative/failure cases for the task, run successfully in an isolated environment.
- [ ] Changes are reviewed; authorization and project/object scope are enforced server-side where applicable.
- [ ] Related OpenAPI/API contract, documentation, and append-only Liquibase migration (if applicable) are updated and verified.
- [ ] CI results and the code/version used for verification are recorded; no secrets or real credentials are committed.
- [ ] Dependencies and partial/error states are handled without losing valid persisted data.
"@
}

$taskSpecs = @(
    [pscustomobject]@{
        Id='DB-014'; Scope=@('Reverify the live `develop` branch against the archived DB 001–012 baseline; do not redo the historical schema design.','Run clean-install and upgrade verification on PostgreSQL 16 with pgvector, inspect checksums and restricted-role grants, and execute the existing SQL integrity/concurrency suite.','Record dated raw logs and any discrepancies for follow-up.'); Acceptance=@('Clean/upgrade PostgreSQL 16+pgvector, checksums, role grants, all prior 78 SQL cases, concurrency, dated raw logs.')
    },
    [pscustomobject]@{
        Id='SET-04'; Scope=@('Scaffold the pull-request CI build and isolated test workflow.','Add contract linting, Testcontainers support, and coverage report generation/output.','Keep tests isolated from development/production databases and use synthetic fixtures.'); Acceptance=@('PR build, contract lint, Testcontainers and coverage output.')
    },
    [pscustomobject]@{
        Id='SET-01'; Scope=@('Review the Core API/security contract and verify JWT, Argon2id and CSRF/cookie exchange choices with a small technical spike.','Confirm compatible dependency versions and document verified behavior and any blockers.','Record peer review of the findings.'); Acceptance=@('Dependency versions and cookie/CSRF exchange verified; peer review recorded.')
    },
    [pscustomobject]@{
        Id='CORE-01'; Scope=@('Implement the refresh-session schema/grants change as Liquibase migration 013.','Keep raw refresh tokens out of storage; enforce required uniqueness and least-privilege application grants.','Verify both clean migration and upgrade from the existing schema.'); Acceptance=@('Clean + upgrade; raw token absent; uniqueness and grants.')
    },
    [pscustomobject]@{
        Id='CORE-02'; Scope=@('Implement the User entity/repository and registration flow with validated input and case-insensitive duplicate-email handling.','Return safe response DTOs only; never expose password hashes or credential fields.','Implement authenticated `GET /api/v1/users/me` returning the current user as a safe User DTO.'); Acceptance=@('201 safe DTO, duplicate case 409, invalid 400; password hash only.','Authenticated `GET /api/v1/users/me` returns the current user using a safe User DTO and rejects unauthenticated access.')
    },
    [pscustomobject]@{
        Id='CORE-03'; Scope=@('Implement login, JWT signing/validation and the active-user authentication filter.','Validate signing keys and required claims; use a secure cookie for the refresh-token exchange as specified by DEC-02.','Return generic authentication failures without leaking whether an account exists.'); Acceptance=@('15-min JWT, generic 401; key/claim validation and secure cookie.')
    },
    [pscustomobject]@{
        Id='CORE-04'; Scope=@('Implement refresh-session rotation, replay detection/revocation, logout and CSRF protection.','Persist only the refresh-token hash, rotate atomically, and revoke the token family on replay.','Define and implement the CSRF token acquisition mechanism required by refresh/logout; document how the browser obtains and returns the token, and reject missing/invalid CSRF tokens.'); Acceptance=@('7-day family, atomic rotate/replay revoke, 204 logout, invalid CSRF rejected.','A documented CSRF token acquisition mechanism supports refresh and logout; missing or invalid tokens are rejected.')
    },
    [pscustomobject]@{
        Id='CORE-05'; Scope=@('Implement project entities/repositories, project-scope authorization guard, create/list/read/update/archive behavior.','Create project and sole Owner membership atomically; conceal foreign project access with the agreed 404 behavior.','Enforce Owner-only project patch/archive actions and read-only behavior after archive.'); Acceptance=@('Atomic project+owner, 404 foreign, owner patch/archive, archive read-only.')
    },
    [pscustomobject]@{
        Id='CORE-06'; Scope=@('Implement project membership listing, adding an existing registered user by email, and removing non-owner members.','Implement ownership transfer transactionally under a row lock; preserve exactly one Owner and prevent orphaned projects.'); Acceptance=@('Add existing email; remove nonowner; transfer under row lock and no orphan.')
    },
    [pscustomobject]@{
        Id='CORE-07'; Scope=@('Add Core integration, API contract and security tests for the registration/authentication/project/membership flows.','Cover negative permissions and project isolation, CSRF, concurrent ownership transfer and concurrent refresh behavior.','Implement global RFC 9457 Problem Details error handling and request DTO validation, with consistent controlled client errors.','Verify the Core OpenAPI contract and API parity in CI; retain test and contract evidence.'); Acceptance=@('Negative permissions, CSRF and concurrent owner/refresh tests; evidence and API parity.','Global RFC 9457 Problem Details handling and DTO validation are implemented and covered by tests.','Core OpenAPI contract verification runs successfully and demonstrates API parity.')
    },
    [pscustomobject]@{
        Id='PLAN-01'; Scope=@('Implement TXT and text-layer PDF specification import, extraction validation, and immutable version lifecycle.','Enforce 10 MiB upload and 200,000 extracted-character limits; reject unsupported, corrupt, empty, or scanned-only documents.','Retain author and prior specification versions; OCR is out of scope.'); Acceptance=@('TXT/PDF text, 10 MiB/200k chars; invalid/scan rejected; versions retained.')
    },
    [pscustomobject]@{
        Id='PLAN-02'; Scope=@('Implement task hierarchy, backlog linkage/revision persistence and dependency DAG validation, including migration 014/018 work assigned to the domain implementation.','Reject invalid parent types, parent cycles, dependency cycles and cross-backlog/foreign dependency edges.','Persist the exact specification/backlog revision linkage and preserve existing valid graph state on rejected changes.'); Acceptance=@('Parent and dependency cycles/foreign edges rejected; revision and linkage persisted.')
    },
    [pscustomobject]@{
        Id='PLAN-03'; Scope=@('Implement draft/task editing and the backlog approval/status lifecycle.','Require the Owner to approve the exact current revision; reject invalid or stale approval attempts.','Re-approval is required after changes to an approved unpublished revision; freeze published backlog structure while allowing permitted task status changes.'); Acceptance=@('Valid changes persist; owner exact revision approval, invalid/stale blocked; published structure frozen.')
    }
)

# Explicit topological order; ties are ordered to make runs deterministic.
$order = @('DB-014','SET-04','SET-01','CORE-01','CORE-02','CORE-03','CORE-04','CORE-05','CORE-06','PLAN-01','PLAN-02','CORE-07','PLAN-03')

try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) was not found on PATH.' }

    $registerPath = Resolve-SourceFile -Name 'Issue_Register.csv'
    $backlogPath = Resolve-SourceFile -Name 'Product_Backlog.md'
    $register = @(Import-Csv -LiteralPath $registerPath)
    $backlogText = Get-Content -LiteralPath $backlogPath -Raw

    $tasks = @{}
    foreach ($id in $order) {
        $rows = @($register | Where-Object { $_.id -eq $id })
        if ($rows.Count -ne 1) { throw "Expected exactly one '$id' row in '$registerPath'; found $($rows.Count)." }
        if ($backlogText -notmatch [regex]::Escape($id)) { throw "Task '$id' is absent from '$backlogPath'." }
        $spec = $taskSpecs | Where-Object { $_.Id -eq $id } | Select-Object -First 1
        if (-not $spec) { throw "No detailed task definition exists in the script for '$id'." }
        $tasks[$id] = [pscustomobject]@{ Id=$id; Registry=$rows[0]; Scope=$spec.Scope; Acceptance=$spec.Acceptance }
    }

    $repoName = (Invoke-Gh -GhArgs @('repo','view',$Repository,'--json','nameWithOwner','--jq','.nameWithOwner') | Out-String).Trim()
    if ($repoName -ne $Repository) { throw "gh is pointed at '$repoName', expected '$Repository'." }

    $labelJson = (Invoke-Gh -GhArgs @('label','list','--repo',$Repository,'--limit','200','--json','name')) -join "`n"
    $script:existingLabelNames = @($labelJson | ConvertFrom-Json | ForEach-Object { $_.name })

    # Check every selected ID, including closed issues, before any create call.
    foreach ($id in $order) {
        $issues = @(Get-AllIssues)
        $found = Find-TaskIssue -Issues $issues -TaskId $id
        if ($found) {
            $script:issueByTaskId[$id] = [pscustomobject]@{ number=$found.number; url=$found.url; state=$found.state }
            $script:completed.Add([pscustomobject]@{ TaskId=$id; Number=$found.number; Url=$found.url; Result='Existing — not modified' })
        }
        elseif (-not $ConfirmCreate) {
            $script:completed.Add([pscustomobject]@{ TaskId=$id; Number='—'; Url='—'; Result='Would create (dry run)' })
        }
        else {
            $task = $tasks[$id]
            $title = "[$id] $($task.Registry.title)"
            $body = New-IssueBody -Task $task
            $tempBody = Join-Path ([System.IO.Path]::GetTempPath()) ("core-issue-{0}.md" -f [guid]::NewGuid().ToString('N'))
            try {
                [System.IO.File]::WriteAllText($tempBody, $body, [System.Text.UTF8Encoding]::new($false))
                $args = @('issue','create','--repo',$Repository,'--title',$title,'--body-file',$tempBody)
                foreach ($label in (Get-ExistingLabelsForTask -Task $task)) { $args += @('--label',$label) }
                $createOutput = (Invoke-Gh -GhArgs $args | Out-String).Trim()
                $createdUrl = [regex]::Match($createOutput, 'https://github\.com/[^\s]+/issues/\d+').Value
                if (-not $createdUrl) {
                    # Recover the created record if gh succeeded but returned unexpected output.
                    $afterCreate = @(Get-AllIssues)
                    $createdIssue = Find-TaskIssue -Issues $afterCreate -TaskId $id
                    if (-not $createdIssue) { throw "gh issue create succeeded but no Issue URL or matching task '$id' could be found. Output: $createOutput" }
                    $createdUrl = $createdIssue.url
                }
                $numberMatch = [regex]::Match($createdUrl, '/issues/(\d+)$')
                if (-not $numberMatch.Success) { throw "Could not parse Issue number from '$createdUrl'." }
                $number = [int]$numberMatch.Groups[1].Value
                $script:issueByTaskId[$id] = [pscustomobject]@{ number=$number; url=$createdUrl; state='open' }
                $script:completed.Add([pscustomobject]@{ TaskId=$id; Number=$number; Url=$createdUrl; Result='Created' })
                Write-Host "Created $id as #$number ($createdUrl)"
            }
            finally {
                if (Test-Path -LiteralPath $tempBody) { Remove-Item -LiteralPath $tempBody -Force }
            }
        }
    }

    if (-not $ConfirmCreate) {
        Write-Host "Dry run only. No Issues were created. Source register: $registerPath"
    }
    else {
        # Final existence/content verification for all selected task IDs. Existing Issues are read-only.
        $verifiedIssues = @(Get-AllIssues)
        foreach ($id in $order) {
            $verified = Find-TaskIssue -Issues $verifiedIssues -TaskId $id
            if (-not $verified) { throw "Final verification failed: Issue for '$id' is not present." }
            $script:issueByTaskId[$id] = [pscustomobject]@{ number=$verified.number; url=$verified.url; state=$verified.state }
            if ($script:completed | Where-Object { $_.TaskId -eq $id -and $_.Result -eq 'Created' }) {
                foreach ($dependencyId in @(([string]$tasks[$id].Registry.depends) -split '\s*,\s*' | Where-Object { $_ -and $_ -notin @('—','-','DB-00') })) {
                    if ($script:issueByTaskId.ContainsKey($dependencyId)) {
                        $dep = $script:issueByTaskId[$dependencyId]
                        if ([string]$verified.body -notmatch [regex]::Escape("/issues/$($dep.number)")) {
                            throw "Dependency verification failed for '$id': body does not reference $dependencyId (#$($dep.number))."
                        }
                    }
                }
            }
        }
        Write-Host "Final verification passed for all $($order.Count) selected task IDs. Existing Issues, including FE-* Issues, were not modified."
    }
}
catch {
    Write-Error "Stopped: $($_.Exception.Message)"
    Write-Host "Partial completion (created Issues are not rolled back; existing Issues are never modified):"
    if ($script:completed.Count -gt 0) {
        $script:completed | Select-Object TaskId,Number,Url,Result | Format-Table -AutoSize | Out-String | Write-Host
    }
    exit 1
}

Write-Host ''
$script:completed | Select-Object TaskId,Number,Url,Result | Format-Table -AutoSize
