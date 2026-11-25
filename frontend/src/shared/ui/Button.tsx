import type { ComponentPropsWithoutRef } from "react";

export function Button({
  type = "button",
  className,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      {...props}
      type={type}
      className={["button", className].filter(Boolean).join(" ")}
    />
  );
}
