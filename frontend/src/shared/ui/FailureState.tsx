import { Button } from "./Button";
import { Panel } from "./Panel";

export function FailureState() {
  return (
    <div className="failure-state">
      <Panel title="Unable to load the workspace">
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </Panel>
    </div>
  );
}
