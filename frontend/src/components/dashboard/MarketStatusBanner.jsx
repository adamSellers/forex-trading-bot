// frontend/src/components/dashboard/MarketStatusBanner.jsx
// Shows forex market status with countdown to open/close

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  Stack,
  LinearProgress,
  alpha,
  useTheme,
  Collapse,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  AccessTime,
  Public,
  TrendingUp,
  NightsStay,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';

// Forex market sessions (in UTC hours)
const SESSIONS = {
  sydney: { name: 'Sydney', start: 21, end: 6, color: '#4caf50', icon: '🇦🇺' },
  tokyo: { name: 'Tokyo', start: 0, end: 9, color: '#f44336', icon: '🇯🇵' },
  london: { name: 'London', start: 7, end: 16, color: '#2196f3', icon: '🇬🇧' },
  newYork: { name: 'New York', start: 12, end: 21, color: '#ff9800', icon: '🇺🇸' },
};

// Market opens Sunday 21:00 UTC, closes Friday 21:00 UTC
const isMarketOpen = (date = new Date()) => {
  const utcDay = date.getUTCDay();
  const utcHour = date.getUTCHours();
  
  // Saturday - always closed
  if (utcDay === 6) return false;
  
  // Sunday - closed until 21:00 UTC
  if (utcDay === 0 && utcHour < 21) return false;
  
  // Friday - closed after 21:00 UTC
  if (utcDay === 5 && utcHour >= 21) return false;
  
  return true;
};

const getNextMarketOpen = (date = new Date()) => {
  const result = new Date(date);
  const utcDay = result.getUTCDay();
  const utcHour = result.getUTCHours();
  
  // Calculate days until Sunday
  let daysToAdd = 0;
  
  if (utcDay === 6) {
    // Saturday -> Sunday
    daysToAdd = 1;
  } else if (utcDay === 0 && utcHour < 21) {
    // Sunday before open -> later today
    daysToAdd = 0;
  } else if (utcDay === 5 && utcHour >= 21) {
    // Friday after close -> next Sunday
    daysToAdd = 2;
  } else {
    // Shouldn't get here if market is open, but handle edge case
    return result;
  }
  
  result.setUTCDate(result.getUTCDate() + daysToAdd);
  result.setUTCHours(21, 0, 0, 0);
  
  // If we're on Sunday, ensure we're set correctly
  while (result.getUTCDay() !== 0) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(21, 0, 0, 0);
  
  return result;
};

const getNextMarketClose = (date = new Date()) => {
  const result = new Date(date);
  const utcDay = result.getUTCDay();
  
  // Find next Friday 21:00 UTC
  let daysToFriday = (5 - utcDay + 7) % 7;
  if (daysToFriday === 0 && result.getUTCHours() >= 21) {
    daysToFriday = 7; // Next Friday
  }
  
  result.setUTCDate(result.getUTCDate() + daysToFriday);
  result.setUTCHours(21, 0, 0, 0);
  
  return result;
};

const formatCountdown = (ms) => {
  if (ms <= 0) return { text: 'Now!', parts: null };
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const h = hours % 24;
  const m = minutes % 60;
  const s = seconds % 60;
  
  if (days > 0) {
    return {
      text: `${days}d ${h}h ${m}m`,
      parts: { days, hours: h, minutes: m, seconds: s },
    };
  } else if (hours > 0) {
    return {
      text: `${h}h ${m}m ${s}s`,
      parts: { days: 0, hours: h, minutes: m, seconds: s },
    };
  } else {
    return {
      text: `${m}m ${s}s`,
      parts: { days: 0, hours: 0, minutes: m, seconds: s },
    };
  }
};

const getActiveSessions = (date = new Date()) => {
  const utcHour = date.getUTCHours();
  const active = [];
  
  Object.entries(SESSIONS).forEach(([key, session]) => {
    let isActive = false;
    
    if (session.start < session.end) {
      // Normal hours (e.g., 9-17)
      isActive = utcHour >= session.start && utcHour < session.end;
    } else {
      // Overnight session (e.g., 21-6)
      isActive = utcHour >= session.start || utcHour < session.end;
    }
    
    if (isActive) {
      active.push({ key, ...session });
    }
  });
  
  return active;
};

const MarketStatusBanner = ({ compact = false }) => {
  const theme = useTheme();
  const [now, setNow] = useState(new Date());
  const [expanded, setExpanded] = useState(false);
  
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const marketOpen = isMarketOpen(now);
  const activeSessions = marketOpen ? getActiveSessions(now) : [];
  const targetTime = marketOpen ? getNextMarketClose(now) : getNextMarketOpen(now);
  const countdown = formatCountdown(targetTime - now);
  
  // Calculate progress through the week (Sunday 21:00 to Friday 21:00)
  const getWeekProgress = () => {
    if (!marketOpen) return 0;
    
    const weekStart = new Date(now);
    // Go back to last Sunday 21:00 UTC
    while (weekStart.getUTCDay() !== 0) {
      weekStart.setUTCDate(weekStart.getUTCDate() - 1);
    }
    weekStart.setUTCHours(21, 0, 0, 0);
    
    const weekEnd = getNextMarketClose(weekStart);
    const totalMs = weekEnd - weekStart;
    const elapsedMs = now - weekStart;
    
    return Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  };
  
  if (compact) {
    return (
      <Chip
        icon={marketOpen ? <TrendingUp /> : <NightsStay />}
        label={marketOpen ? 'Markets Open' : `Opens in ${countdown.text}`}
        size="small"
        sx={{
          bgcolor: marketOpen 
            ? alpha(theme.palette.success.main, 0.15)
            : alpha(theme.palette.warning.main, 0.15),
          color: marketOpen ? 'success.main' : 'warning.main',
          fontWeight: 'bold',
          '& .MuiChip-icon': {
            color: 'inherit',
          },
        }}
      />
    );
  }
  
  return (
    <Box
      sx={{
        bgcolor: marketOpen
          ? alpha(theme.palette.success.main, 0.08)
          : alpha(theme.palette.warning.main, 0.08),
        borderRadius: 2,
        border: 1,
        borderColor: marketOpen
          ? alpha(theme.palette.success.main, 0.3)
          : alpha(theme.palette.warning.main, 0.3),
        overflow: 'hidden',
        mb: 2,
      }}
    >
      {/* Main Banner */}
      <Box
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: marketOpen
                ? alpha(theme.palette.success.main, 0.2)
                : alpha(theme.palette.warning.main, 0.2),
            }}
          >
            {marketOpen ? (
              <TrendingUp sx={{ color: 'success.main' }} />
            ) : (
              <NightsStay sx={{ color: 'warning.main' }} />
            )}
          </Box>
          
          <Box>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              color={marketOpen ? 'success.main' : 'warning.main'}
            >
              {marketOpen ? '🟢 MARKETS OPEN' : '🔴 MARKETS CLOSED'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {marketOpen
                ? `Closes Friday ${targetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local`
                : 'Forex markets closed for the weekend'}
            </Typography>
          </Box>
        </Stack>
        
        <Stack direction="row" spacing={2} alignItems="center">
          {/* Countdown */}
          <Box textAlign="right">
            <Typography variant="caption" color="text.secondary">
              {marketOpen ? 'Closes in' : 'Opens in'}
            </Typography>
            <Typography
              variant="h6"
              fontWeight="bold"
              fontFamily="monospace"
              color={marketOpen ? 'success.main' : 'warning.main'}
            >
              {countdown.text}
            </Typography>
          </Box>
          
          {/* Active Sessions Chips */}
          {marketOpen && activeSessions.length > 0 && (
            <Stack direction="row" spacing={0.5}>
              {activeSessions.map((session) => (
                <Tooltip key={session.key} title={`${session.name} Session`}>
                  <Chip
                    label={session.icon}
                    size="small"
                    sx={{
                      bgcolor: alpha(session.color, 0.2),
                      borderColor: session.color,
                      border: 1,
                      minWidth: 36,
                      '& .MuiChip-label': { px: 1 },
                    }}
                  />
                </Tooltip>
              ))}
            </Stack>
          )}
          
          <IconButton size="small">
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Stack>
      </Box>
      
      {/* Progress Bar */}
      {marketOpen && (
        <LinearProgress
          variant="determinate"
          value={getWeekProgress()}
          sx={{
            height: 3,
            bgcolor: alpha(theme.palette.success.main, 0.1),
            '& .MuiLinearProgress-bar': {
              bgcolor: 'success.main',
            },
          }}
        />
      )}
      
      {/* Expanded Details */}
      <Collapse in={expanded}>
        <Box
          sx={{
            p: 2,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.paper, 0.5),
          }}
        >
          <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
            TRADING SESSIONS (UTC)
          </Typography>
          
          <Stack spacing={1}>
            {Object.entries(SESSIONS).map(([key, session]) => {
              const isActive = activeSessions.some((s) => s.key === key);
              return (
                <Box
                  key={key}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1,
                    borderRadius: 1,
                    bgcolor: isActive
                      ? alpha(session.color, 0.15)
                      : alpha(theme.palette.action.hover, 0.5),
                    border: 1,
                    borderColor: isActive ? session.color : 'transparent',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography>{session.icon}</Typography>
                    <Typography
                      variant="body2"
                      fontWeight={isActive ? 'bold' : 'normal'}
                      color={isActive ? session.color : 'text.secondary'}
                    >
                      {session.name}
                    </Typography>
                    {isActive && (
                      <Chip
                        label="LIVE"
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.65rem',
                          bgcolor: session.color,
                          color: 'white',
                          animation: 'pulse 2s infinite',
                          '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                          },
                        }}
                      />
                    )}
                  </Stack>
                  <Typography
                    variant="caption"
                    fontFamily="monospace"
                    color="text.secondary"
                  >
                    {String(session.start).padStart(2, '0')}:00 - {String(session.end).padStart(2, '0')}:00
                  </Typography>
                </Box>
              );
            })}
          </Stack>
          
          <Box mt={2} p={1.5} borderRadius={1} bgcolor={alpha(theme.palette.info.main, 0.1)}>
            <Typography variant="caption" color="text.secondary">
              <AccessTime sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
              Forex markets are open 24/5 from Sunday 21:00 UTC to Friday 21:00 UTC.
              Best trading times are during session overlaps (London/NY and Tokyo/Sydney).
            </Typography>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
};

export default MarketStatusBanner;