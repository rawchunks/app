import React from "react";
import { Button as BaseButton } from "@/components/button";

export interface ButtonProps {
  children: React.ReactNode;
  variant?: "solid" | "outline" | "ghost" | "danger" | "neon";
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  type?: "button" | "submit" | "reset";
}

export const Button: React.FC<ButtonProps> = ({
  variant = "solid",
  size = "md",
  children,
  onClick,
  disabled,
  style,
  className,
}) => {
  const mapVariant = (): "primary" | "secondary" | "accent" | "ghost" => {
    if (variant === "outline" || variant === "ghost") return "ghost";
    if (variant === "danger") return "secondary";
    return "primary";
  };

  return (
    <BaseButton
      variant={mapVariant()}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={style}
    >
      {children}
    </BaseButton>
  );
};
