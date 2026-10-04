"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Children, Fragment, isValidElement, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string };
type Option = { value: string; label: ReactNode; disabled?: boolean };
type SelectProps = Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>, "children" | "value" | "onChange" | "defaultValue"> & {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  form?: string;
  displayValue?: ReactNode;
};

// Keep existing translated/dynamic option declarations at each call site.
function optionsFrom(children: ReactNode): Option[] {
  const options: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === Fragment) options.push(...optionsFrom(child.props.children));
    else if (child.type === "option") {
      options.push({
        value: String(child.props.value ?? child.props.children ?? ""),
        label: child.props.label ?? child.props.children,
        disabled: child.props.disabled,
      });
    }
  });
  return options;
}

function Chevron({ up = false }: { up?: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>;
}

/** Shared, themed single-select: portalled menu, touch/keyboard navigation,
 * typeahead, focus restoration and native form participation via Radix. */
export function Select({ children, value, defaultValue, onValueChange, name, required, form, disabled, displayValue, className = "", ...triggerProps }: SelectProps) {
  const options = optionsFrom(children);
  const [localValue, setLocalValue] = useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const selected = value === undefined ? localValue : String(value);
  const emptyOption = options.find((option) => option.value === "");
  // Radix reserves the empty string for its placeholder. Map a reset option
  // to a private menu value, but keep the actual form value empty/invalid.
  let emptyMenuValue = "__peebee_empty_option__";
  while (options.some((option) => option.value === emptyMenuValue)) emptyMenuValue += "_";

  return (
    <span className="peebee-select-wrapper" onInvalidCapture={(event) => {
      // Keep browser constraint validation, but direct the user to the custom
      // menu rather than focusing/opening Radix's hidden native form control.
      event.preventDefault();
      setInvalid(true);
      setOpen(true);
    }}>
    <SelectPrimitive.Root open={open} onOpenChange={setOpen} value={selected} onValueChange={(next) => {
      const result = next === emptyMenuValue ? "" : next;
      if (value === undefined) setLocalValue(result);
      setInvalid(required === true && result === "");
      onValueChange?.(result);
    }} name={name} required={required} disabled={disabled} form={form}>
      <SelectPrimitive.Trigger aria-invalid={(invalid && required && selected === "") || undefined} {...triggerProps} className={`peebee-select-trigger ${className}`}>
        <span className="peebee-select-value"><SelectPrimitive.Value placeholder={emptyOption?.label ?? "Select…"}>{displayValue}</SelectPrimitive.Value></span>
        <SelectPrimitive.Icon className="peebee-select-chevron"><Chevron /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="peebee-select-menu" position="popper" sideOffset={6} collisionPadding={12} align="start">
          <SelectPrimitive.ScrollUpButton className="peebee-select-scroll"><Chevron up /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="peebee-select-options">
            {options.map((option) => (
              <SelectPrimitive.Item key={option.value} value={option.value || emptyMenuValue} disabled={option.disabled} aria-selected={option.value === selected} className="peebee-select-option">
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {(option.value === "" && selected === "") ? <span className="peebee-select-check" aria-hidden="true">✓</span> : <SelectPrimitive.ItemIndicator className="peebee-select-check" aria-hidden="true">✓</SelectPrimitive.ItemIndicator>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="peebee-select-scroll"><Chevron /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
    </span>
  );
}
