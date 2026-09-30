import React from "react";
import { Badge as BaseBadge, Props as BaseBadgeProps } from "@/components/badge";

export interface BadgeProps {
  children: React.ReactNode;
  tone?: "gold" | "green" | "pink" | "cyan" | "muted";
  variant?: BaseBadgeProps["variant"];
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({ tone, variant, children, style }) => {
  const mapVariant = (): BaseBadgeProps["variant"] => {
    if (tone === "gold" || tone === "green") return "primary";
    if (tone === "pink") return "secondary";
    if (tone === "cyan") return "accent";
    if (tone === "muted") return "muted";
    return variant || "primary";
  };

  return (
    <BaseBadge variant={mapVariant()} style={style}>
      {children}
    </BaseBadge>
  );
};
