# ===================================================
# scripts/logs.sh - View production logs easily
# ===================================================
#!/bin/bash

PROD_HOST="img.oakroad"
PROD_USER="adam"

case "$1" in
    "pm2"|"")
        echo "📋 PM2 Logs:"
        ssh $PROD_USER@$PROD_HOST "pm2 logs img-backend --lines 50"
        ;;
    "nginx")
        echo "📋 Nginx Access Logs:"
        ssh $PROD_USER@$PROD_HOST "sudo tail -f /var/log/nginx/access.log"
        ;;
    "nginx-error")
        echo "📋 Nginx Error Logs:"
        ssh $PROD_USER@$PROD_HOST "sudo tail -f /var/log/nginx/error.log"
        ;;
    "app")
        echo "📋 Application Logs:"
        ssh $PROD_USER@$PROD_HOST "tail -f /opt/crypto-trading-bot/backend/logs/*.log"
        ;;
    "system")
        echo "📋 System Logs:"
        ssh $PROD_USER@$PROD_HOST "journalctl -u nginx -f"
        ;;
    *)
        echo "Usage: $0 [pm2|nginx|nginx-error|app|system]"
        echo "  pm2         - PM2 process logs (default)"
        echo "  nginx       - Nginx access logs"
        echo "  nginx-error - Nginx error logs"
        echo "  app         - Application logs"
        echo "  system      - System service logs"
        ;;
esac