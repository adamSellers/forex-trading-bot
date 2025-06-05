# ===================================================
# scripts/dev-setup.sh - Set up local development
# ===================================================
#!/bin/bash
set -e

echo "🛠️ Setting up local development environment..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install
npm run install:backend
npm run install:frontend

# Set up environment files
echo "⚙️ Setting up environment files..."

if [[ ! -f "backend/.env" ]]; then
    cp backend/.env.example backend/.env 2>/dev/null || cat > backend/.env << 'EOF'
NODE_ENV=development
PORT=3001
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here
USE_REAL_BINANCE_DATA=false
CORS_ORIGIN=http://localhost:5173
EOF
    echo "✅ Created backend/.env"
fi

if [[ ! -f "frontend/.env.development" ]]; then
    cat > frontend/.env.development << 'EOF'
VITE_API_BASE_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
EOF
    echo "✅ Created frontend/.env.development"
fi

# Set up database
echo "🗄️ Setting up database..."
npm run db:migrate

# Build frontend
echo "🏗️ Building frontend..."
npm run build:frontend

echo "🎉 Development setup complete!"
echo
echo "🚀 To start development:"
echo "  Terminal 1: npm run dev:backend"
echo "  Terminal 2: npm run dev:frontend"
echo "  Then visit: http://localhost:5173"