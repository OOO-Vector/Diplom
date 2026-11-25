package com.teamai.orchestrator.core.api;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.teamai.orchestrator.core.application.CoreException;
import jakarta.validation.constraints.Pattern;

/** Presence is separate from value: omitted description is unchanged, explicit null clears it. */
public class UpdateProjectRequest {
    @UnicodeLength(min = 1, max = 150) @Pattern(regexp = "[^\\x00]*") private String name;
    @UnicodeLength(max = 4000) @Pattern(regexp = "[^\\x00]*") private String description;
    private boolean namePresent, descriptionPresent;
    @JsonSetter("name") public void setName(String name) { namePresent = true; this.name = name == null ? null : name.strip(); }
    @JsonSetter("description") public void setDescription(String description) { descriptionPresent = true; this.description = description; }
    public String name() { return name; }
    public String description() { return description; }
    public boolean hasName() { return namePresent; }
    public boolean hasDescription() { return descriptionPresent; }
    public void validatePresence() {
        if ((!namePresent && !descriptionPresent) || (namePresent && (name == null || name.isBlank())))
            throw CoreException.invalid();
    }
}
