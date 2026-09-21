import { darkTheme } from "thirdweb/react";

/**
 * Cyberpunk Theme Configuration for Thirdweb ConnectButton and ConnectModal.
 * Centralized in @/styles to satisfy the architecture requirement of
 * extracting all in-component styling away from individual files and modules.
 */
export const thirdwebCustomTheme = darkTheme({
  colors: {
    primaryButtonBg: "#00ff41",
    primaryButtonText: "#050505",
    accentButtonBg: "#00ff41",
    accentButtonText: "#050505",
    accentText: "#00ff41",
    borderColor: "rgba(0, 255, 65, 0.25)",
    separatorLine: "rgba(255, 255, 255, 0.08)",
    modalBg: "#09090e",
    modalOverlayBg: "rgba(0, 0, 0, 0.88)",
    inputAutofillBg: "#101016",
    secondaryButtonBg: "#101016",
    secondaryButtonHoverBg: "#181824",
    secondaryButtonText: "#ffffff",
    connectedButtonBg: "#09090e",
    connectedButtonBgHover: "#101016",
    secondaryText: "#888899",
    primaryText: "#ffffff",
    danger: "#ff0055",
    success: "#00ff41",
    selectedTextBg: "rgba(0, 255, 65, 0.15)",
    selectedTextColor: "#00ff41",
    skeletonBg: "#15151B",
    tertiaryBg: "#09090e",
    tooltipBg: "#101016",
    tooltipText: "#ffffff",
    scrollbarBg: "#101016",
    secondaryIconColor: "#888899",
    secondaryIconHoverBg: "#181824",
    secondaryIconHoverColor: "#00ff41",
  },
  fontFamily: "var(--font-family, 'Courier New', Courier, monospace)",
});
