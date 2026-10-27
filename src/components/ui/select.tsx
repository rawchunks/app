import React, { createContext, useContext, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/hooks/use-dismiss";

interface SelectContextType {
  value: string;
  onValueChange: (val: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SelectContext = createContext<SelectContextType | null>(null);

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false), containerRef);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div ref={containerRef} className="select-wrapper">
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps {
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

export function SelectTrigger({ className, children, "aria-label": ariaLabel }: SelectTriggerProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("SelectTrigger must be used within Select");

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => ctx.setOpen(!ctx.open)}
      className={cn(
        "select-trigger",
        className
      )}
    >
      {children}
    </button>
  );
}

export interface SelectContentProps {
  className?: string;
  children: React.ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("SelectContent must be used within Select");

  if (!ctx.open) return null;

  return (
    <div className={cn("select-content", className)}>
      {children}
    </div>
  );
}

export interface SelectItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function SelectItem({ value, className, children }: SelectItemProps) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("SelectItem must be used within Select");

  const isSelected = ctx.value === value;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        ctx.onValueChange(value);
        ctx.setOpen(false);
      }}
      className={cn("select-item", isSelected && "select-item-selected", className)}
    >
      {children}
    </div>
  );
}
