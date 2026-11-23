package com.teamai.orchestrator.core.api;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.nio.charset.StandardCharsets;

public class UnicodeLengthValidator implements ConstraintValidator<UnicodeLength, String> {
    private int min, max, maxBytes;
    public void initialize(UnicodeLength constraint) {
        min = constraint.min(); max = constraint.max(); maxBytes = constraint.maxBytes();
    }
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        int count = value.codePointCount(0, value.length());
        return count >= min && count <= max
                && value.codePoints().noneMatch(c -> c == 0 || (c >= 0xD800 && c <= 0xDFFF))
                && value.getBytes(StandardCharsets.UTF_8).length <= maxBytes;
    }
}
