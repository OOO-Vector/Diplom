package com.teamai.orchestrator.core.api;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.*;

@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = UnicodeLengthValidator.class)
public @interface UnicodeLength {
    String message() default "Invalid Unicode length";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
    int min() default 0;
    int max();
    int maxBytes() default Integer.MAX_VALUE;
}
