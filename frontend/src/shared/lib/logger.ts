type ErrorEvent = "app.failure" | "route.failure" | "api.failure";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const requestId = /^req-[0-9a-f]{8,32}$/i;

export function logError(
  event: ErrorEvent,
  context: {
    status?: unknown;
    correlationId?: unknown;
    operationId?: unknown;
  } = {},
) {
  const { status, correlationId, operationId } = context;
  const fields: {
    status?: number;
    correlationId?: string;
    operationId?: string;
  } = {};
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  ) {
    fields.status = status;
  }
  if (
    typeof correlationId === "string" &&
    (uuid.test(correlationId) || requestId.test(correlationId))
  ) {
    fields.correlationId = correlationId;
  }
  if (typeof operationId === "string" && uuid.test(operationId)) {
    fields.operationId = operationId;
  }
  console.error(event, fields);
}
