import { Paper, Typography, Box, styled, alpha } from '@mui/material';

// ============ STYLED COMPONENTS ============

export const GlassCard = styled(Paper)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.05),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.1)',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.primary.main, 0.3),
  }
}));

export const MetricValue = styled(Typography)(() => ({
  fontFamily: '"Roboto Mono", monospace',
  fontWeight: 700,
  letterSpacing: '-0.5px'
}));

// ============ REUSABLE COMPONENTS ============

/**
 * Empty state display for when there's no data
 */
export const EmptyState = ({ icon, message, subMessage }) => (
  <Box
    height="100%"
    display="flex"
    flexDirection="column"
    alignItems="center"
    justifyContent="center"
    color="text.secondary"
    p={4}
  >
    <Box sx={{ opacity: 0.2, mb: 2 }}>{icon}</Box>
    <Typography variant="body2" fontWeight="bold">
      {message}
    </Typography>
    {subMessage && (
      <Typography variant="caption" sx={{ opacity: 0.6, mt: 0.5 }}>
        {subMessage}
      </Typography>
    )}
  </Box>
);

// ============ FOREX UTILITY FUNCTIONS ============

/**
 * Format currency value (AUD base currency)
 * @param {number} value - The value to format
 * @param {string} currency - Currency code (default: 'AUD')
 */
export const formatCurrency = (value, currency = 'AUD') => {
  if (value === null || value === undefined || isNaN(value)) return '---';
  
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Currency formatter for charts (simpler format)
 * @param {number} value - The value to format
 */
export const currencyFormatter = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '';
  return `A$${value.toFixed(2)}`;
};

/**
 * Format Forex price with appropriate decimal places
 * - JPY pairs: 3 decimal places (e.g., 150.123)
 * - Standard pairs: 5 decimal places (e.g., 0.65432)
 * @param {number} price - The price to format
 * @param {string} instrument - The instrument (e.g., 'AUD_USD', 'USD_JPY')
 */
export const formatPrice = (price, instrument = '') => {
  if (price === null || price === undefined || isNaN(price)) return '---';
  
  // JPY pairs use fewer decimal places
  const isJpyPair = instrument.includes('JPY');
  const decimals = isJpyPair ? 3 : 5;
  
  return parseFloat(price).toFixed(decimals);
};

/**
 * Format instrument for display (AUD_USD â†’ AUD/USD)
 * @param {string} instrument - The instrument code
 */
export const formatInstrument = (instrument) => {
  if (!instrument) return '---';
  return instrument.replace('_', '/');
};

/**
 * Get pip value for an instrument
 * @param {string} instrument - The instrument code
 */
export const getPipValue = (instrument) => {
  return instrument?.includes('JPY') ? 0.01 : 0.0001;
};

/**
 * Calculate pips from price difference
 * @param {number} priceDiff - Price difference
 * @param {string} instrument - The instrument code
 */
export const calculatePips = (priceDiff, instrument) => {
  const pipValue = getPipValue(instrument);
  return priceDiff / pipValue;
};

// ============ CONSTANTS ============

export const FOREX_INSTRUMENTS = ['AUD_USD', 'EUR_USD', 'GBP_USD', 'USD_JPY'];

export const INSTRUMENT_INFO = {
  'AUD_USD': { name: 'Australian Dollar / US Dollar', flag: 'ðŸ‡¦ðŸ‡º' },
  'EUR_USD': { name: 'Euro / US Dollar', flag: 'ðŸ‡ªðŸ‡º' },
  'GBP_USD': { name: 'British Pound / US Dollar', flag: 'ðŸ‡¬ðŸ‡§' },
  'USD_JPY': { name: 'US Dollar / Japanese Yen', flag: 'ðŸ‡¯ðŸ‡µ' },
};