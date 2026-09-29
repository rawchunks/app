import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DropdownMenuContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextType | null>(null);

export interface DropdownMenuProps {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({ children, onOpenChange }: DropdownMenuProps) {
  const [open, setOpenState] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div ref={containerRef} className="dropdown-menu-wrapper">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export interface DropdownMenuTriggerProps {
  asChild?: boolean;
  children: React.ReactNode;
}

export function DropdownMenuTrigger({ asChild, children }: DropdownMenuTriggerProps) {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenuTrigger must be used within DropdownMenu");

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.setOpen(!ctx.open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>, {
      onClick: (e: React.MouseEvent) => {
        (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
        handleClick(e);
      },
    });
  }

  return (
    <button type="button" onClick={handleClick}>
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps {
  align?: "start" | "end" | "center";
  className?: string;
  children: React.ReactNode;
}

export function DropdownMenuContent({ align = "start", className, children }: DropdownMenuContentProps) {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenuContent must be used within DropdownMenu");

  if (!ctx.open) return null;

  return (
    <div
      className={cn(
        "dropdown-menu-content",
        align === "end" ? "dropdown-menu-align-end" : "dropdown-menu-align-start",
        className
      )}
    >
      {children}
    </div>
  );
}

export interface DropdownMenuItemProps {
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function DropdownMenuItem({ onClick, className, children }: DropdownMenuItemProps) {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenuItem must be used within DropdownMenu");

  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={() => {
        onClick?.();
        ctx.setOpen(false);
      }}
      className={cn("dropdown-menu-item", className)}
    >
      {children}
    </div>
  );
}
