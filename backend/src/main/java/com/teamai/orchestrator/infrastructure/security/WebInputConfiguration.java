package com.teamai.orchestrator.infrastructure.security;

import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.InitBinder;
import java.beans.PropertyEditorSupport;
import java.util.UUID;

@ControllerAdvice
public class WebInputConfiguration {
    @InitBinder public void bindUuids(WebDataBinder binder) {
        binder.registerCustomEditor(UUID.class, new PropertyEditorSupport() {
            @Override public void setAsText(String value) {
                var id = UUID.fromString(value);
                if (!id.toString().equalsIgnoreCase(value)) throw new IllegalArgumentException("Invalid UUID");
                setValue(id);
            }
        });
    }
}
