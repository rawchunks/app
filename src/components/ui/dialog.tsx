import React, { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

interface DialogContextType {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compulsory?: boolean;
}

const DialogContext = createContext<DialogContextType | null>(null);

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  compulsory?: boolean;
  children: React.ReactNode;
}

export function Dialog({ open = false, onOpenChange = () => {}, compulsory = false, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange, compulsory }}>
      {children}
    </DialogContext.Provider>
  );
}

export interface DialogContentProps {
  className?: string;
  children: React.ReactNode;
}

export function DialogContent({ className, children }: DialogContentProps) {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("DialogContent must be used within Dialog");

  if (!ctx.open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!ctx.compulsory) {
          ctx.onOpenChange(false);
        }
      }}
    >
      <div
        className={cn("dialog-content", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export interface DialogHeaderProps {
  className?: string;
  children: React.ReactNode;
}

export function DialogHeader({ className, children }: DialogHeaderProps) {
  return (
    <div className={cn("dialog-header", className)}>
      {children}
    </div>
  );
}

export interface DialogTitleProps {
  className?: string;
  children: React.ReactNode;
}

export function DialogTitle({ className, children }: DialogTitleProps) {
  return (
    <h3 className={cn("dialog-title", className)}>
      {children}
    </h3>
  );
}

export interface DialogDescriptionProps {
  className?: string;
  children: React.ReactNode;
}

export function DialogDescription({ className, children }: DialogDescriptionProps) {
  return (
    <p className={cn("dialog-description", className)}>
      {children}
    </p>
  );
}
