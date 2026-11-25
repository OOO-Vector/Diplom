import { z } from "zod";

const problemDetailsSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().min(400).max(599).optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  fieldErrors: z.array(z.object({ field: z.string() })).optional(),
  errorCode: z.string().optional(),
  correlationId: z.string().optional(),
  operationId: z.string().optional(),
  retryable: z.boolean().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export function parseProblemDetails(
  value: unknown,
): ProblemDetails | undefined {
  const result = problemDetailsSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
