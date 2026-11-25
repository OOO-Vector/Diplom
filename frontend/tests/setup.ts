import { transferableAbortController } from "node:util";

if (typeof document !== "undefined") {
  // React Router constructs a Node Fetch Request with an AbortSignal.
  // Keep the test globals in the same realm as Node's Request.
  const controller = transferableAbortController();
  Object.assign(globalThis, {
    AbortController: controller.constructor,
    AbortSignal: controller.signal.constructor,
  });
}
