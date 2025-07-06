// frontend/src/theme/tradingTheme.js - Enhanced theme for proper grid layout
import { createTheme } from "@mui/material/styles";

// Asset color palette
export const assetColors = {
    BTCUSDT: "#f7931a", // Bitcoin orange
    ETHUSDT: "#627eea", // Ethereum blue
    BNBUSDT: "#f3ba2f", // Binance yellow
    DOGEUSDT: "#c3a635", // Dogecoin gold
    USDT: "#26a17b", // Tether green
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
        // CRITICAL: Grid system fixes
        MuiGrid: {
            styleOverrides: {
                container: {
                    width: "100%",
                    margin: 0,
                    "& > .MuiGrid-item": {
                        paddingLeft: 0,
                        paddingTop: 0,
                    },
                },
                item: {
                    // Ensure grid items take full width
                    maxWidth: "100%",
                    flexBasis: "auto",
                },
            },
        },

        // Container fixes
        MuiContainer: {
            styleOverrides: {
                root: {
                    paddingLeft: "24px !important",
                    paddingRight: "24px !important",
                    maxWidth: "none !important",
                    width: "100%",
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
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    // CRITICAL: Ensure cards fill container
                    width: "100%",
                    minWidth: 0, // Allow shrinking
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
                    // Ensure full width utilization
                    width: "100%",
                    boxSizing: "border-box",
                },
            },
        },

        // Card content spacing
        MuiCardContent: {
            styleOverrides: {
                root: {
                    padding: "12px !important",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100%",
                    "&:last-child": {
                        paddingBottom: "12px !important",
                    },
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
                    textAlign: "center",
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
    spacing: 8, // Base spacing unit

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

// Custom CSS for grid layout fixes
export const globalGridStyles = `
  /* Ensure full width utilization */
  .MuiContainer-root {
    width: 100% !important;
    max-width: none !important;
    padding-left: 24px !important;
    padding-right: 24px !important;
  }
  
  /* Grid container fixes */
  .MuiGrid-container {
    width: 100% !important;
    margin: 0 !important;
  }
  
  /* Grid item fixes for equal width distribution */
  .MuiGrid-grid-xs-3 {
    flex-basis: 25% !important;
    max-width: 25% !important;
    width: 25% !important;
  }
  
  /* Card container fixes */
  .MuiCard-root {
    width: 100% !important;
    min-width: 0 !important;
    box-sizing: border-box !important;
  }
  
  /* Prevent text overflow in small cards */
  .MuiCardContent-root {
    min-width: 0 !important;
    overflow: hidden !important;
  }
  
  /* Typography responsive fixes */
  .MuiTypography-root {
    word-break: break-word;
    overflow-wrap: break-word;
  }
  
  /* Trading dashboard specific styles */
  .trading-dashboard {
    width: 100%;
    min-height: 100vh;
  }
  
  .portfolio-grid {
    width: 100% !important;
  }
  
  .metric-card {
    height: 100px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  
  /* Debug grid overlay (remove in production) */
  .debug-grid .MuiGrid-item {
    border: 1px dashed rgba(255, 255, 255, 0.1) !important;
  }
`;

export default tradingTheme;
