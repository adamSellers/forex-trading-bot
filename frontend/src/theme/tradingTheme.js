// frontend/src/theme/tradingTheme.js - Forex Trading Theme
import { createTheme } from "@mui/material/styles";

// Forex pair color palette
export const assetColors = {
    AUD_USD: "#002B7F", // Australian blue
    EUR_USD: "#003399", // EU blue
    GBP_USD: "#012169", // British blue
    USD_JPY: "#BC002D", // Japanese red
    // Base currencies
    AUD: "#FFCD00", // Australian gold
    USD: "#3C3B6E", // US blue
    EUR: "#003399", // EU blue
    GBP: "#012169", // British blue
    JPY: "#BC002D", // Japanese red
};

// Create enhanced dark theme for trading dashboard
export const tradingTheme = createTheme({
    palette: {
        mode: "dark",
        primary: {
            main: "#00bcd4",
            light: "#4dd0e1",
            dark: "#00838f",
        },
        secondary: {
            main: "#ff5722",
            light: "#ff8a65",
            dark: "#d84315",
        },
        success: {
            main: "#4caf50",
            light: "#81c784",
            dark: "#2e7d32",
        },
        error: {
            main: "#f44336",
            light: "#e57373",
            dark: "#c62828",
        },
        warning: {
            main: "#ff9800",
            light: "#ffb74d",
            dark: "#f57c00",
        },
        info: {
            main: "#2196f3",
            light: "#64b5f6",
            dark: "#1976d2",
        },
        background: {
            default: "#121212",
            paper: "#1e1e1e",
        },
        text: {
            primary: "#ffffff",
            secondary: "#b0b0b0",
        },
    },

    components: {
        // --- GRID FIX: First Principles Fix ---
        MuiGrid: {
            styleOverrides: {
                container: {
                    display: "flex",
                    flexWrap: "wrap",
                },
                item: {
                    flexGrow: 0,
                    flexShrink: 0,
                },
            },
        },

        // Card styling for metrics
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundColor: "#1e1e1e",
                    borderColor: "#333",
                    borderRadius: 8,
                    minHeight: "100px",
                    minWidth: 0,
                    boxSizing: "border-box",
                },
            },
        },

        // Paper component styling
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundColor: "#1e1e1e",
                    borderRadius: 12,
                    border: "1px solid #333",
                    boxSizing: "border-box",
                },
            },
        },

        // Typography responsive sizing
        MuiTypography: {
            styleOverrides: {
                h6: {
                    fontSize: "1rem",
                    fontWeight: 600,
                    lineHeight: 1.2,
                },
                body2: {
                    fontSize: "0.875rem",
                    lineHeight: 1.3,
                },
                caption: {
                    fontSize: "0.75rem",
                    opacity: 0.8,
                },
            },
        },

        // Chip styling for status indicators
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    fontSize: "0.75rem",
                    height: 24,
                },
                colorSuccess: {
                    backgroundColor: "#4caf50",
                    color: "#ffffff",
                },
                colorError: {
                    backgroundColor: "#f44336",
                    color: "#ffffff",
                },
                colorPrimary: {
                    backgroundColor: "#00bcd4",
                    color: "#ffffff",
                },
            },
        },

        // Button styling
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    textTransform: "none",
                    fontWeight: 600,
                },
                contained: {
                    boxShadow: "none",
                    "&:hover": {
                        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    },
                },
            },
        },

        // Form controls
        MuiSelect: {
            styleOverrides: {
                root: {
                    "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#444",
                    },
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#666",
                    },
                },
            },
        },

        // Alert styling
        MuiAlert: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    "& .MuiAlert-icon": {
                        fontSize: "1.25rem",
                    },
                },
            },
        },
    },

    // Custom breakpoints for responsive design
    breakpoints: {
        values: {
            xs: 0,
            sm: 600,
            md: 960,
            lg: 1280,
            xl: 1920,
        },
    },

    // Custom spacing scale
    spacing: 8,

    // Typography scale
    typography: {
        fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
        h4: {
            fontSize: "2rem",
            fontWeight: 600,
            lineHeight: 1.2,
        },
        h6: {
            fontSize: "1.125rem",
            fontWeight: 600,
            lineHeight: 1.3,
        },
        body1: {
            fontSize: "1rem",
            lineHeight: 1.4,
        },
        body2: {
            fontSize: "0.875rem",
            lineHeight: 1.4,
        },
        caption: {
            fontSize: "0.75rem",
            lineHeight: 1.3,
            opacity: 0.8,
        },
    },
});

export default tradingTheme;
