import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { clsx } from "clsx";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className, options, ...props },
  ref
) {
  const generatedId = useId();
  const selectId = id || generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        className={clsx(
          "rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand",
          error && "border-danger focus:ring-danger",
          className
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
});
