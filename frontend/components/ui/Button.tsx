import { type ButtonHTMLAttributes, forwardRef } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-brand-foreground shadow-sm hover:opacity-90 hover:shadow-lg hover:shadow-brand/20 focus-visible:ring-brand",
  secondary:
    "bg-surface-muted text-foreground border border-border-subtle hover:bg-border focus-visible:ring-brand",
  danger: "bg-danger text-white hover:opacity-90 focus-visible:ring-danger",
  ghost: "bg-transparent text-foreground hover:bg-surface-muted focus-visible:ring-brand",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
});
