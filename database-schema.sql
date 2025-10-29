-- Database schema for Liaision payment and tokenomics system
-- Note: User token balances are for INTERNAL tracking only
-- NO user-facing queries for token balances per requirements

-- Table: payments
-- Stores all payment transactions from Stripe and Razorpay
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  payment_provider VARCHAR(50) NOT NULL, -- 'stripe' or 'razorpay'
  payment_id VARCHAR(255) NOT NULL UNIQUE,
  plan_type VARCHAR(100),
  status VARCHAR(50) NOT NULL, -- 'completed', 'pending', 'failed'
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_id (user_id),
  INDEX idx_payment_provider (payment_provider),
  INDEX idx_created_at (created_at)
);

-- Table: user_tokens
-- Internal tracking of LIAISON token balances
-- IMPORTANT: This is for backend/admin use only - NO user-facing queries
CREATE TABLE IF NOT EXISTS user_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  liaison_tokens DECIMAL(18, 8) NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_id (user_id)
);

-- Table: audit_logs
-- Comprehensive logging of all token swap operations
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL, -- 'token_swap', 'payment_received', etc.
  details JSONB, -- Stores full details including amounts, rates, provider info
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_id (user_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
);

-- Additional Notes:
-- 1. Set up DATABASE_URL environment variable in Vercel
-- 2. Run this schema on your PostgreSQL database
-- 3. Ensure proper database permissions for the application
-- 4. Consider adding foreign key constraints if you have a users table
-- 5. Token balances are maintained internally and not exposed to users
