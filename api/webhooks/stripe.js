import Stripe from 'stripe';
import { Pool } from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const session = event.data.object;
    
    try {
      await processPaymentSuccess(session);
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Error processing payment:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(200).json({ received: true });
}

async function processPaymentSuccess(session) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const userId = session.metadata?.userId || session.customer_email;
    const amountPaid = session.amount_total / 100; // Convert from cents to currency
    const currency = session.currency?.toUpperCase() || 'USD';
    const planType = session.metadata?.planType || 'unknown';
    
    // Calculate LIAISON tokens based on exchange rate
    const exchangeRate = parseFloat(process.env.LIAISON_TOKEN_EXCHANGE_RATE) || 1;
    const liaisonTokens = amountPaid * exchangeRate;

    // Insert payment record
    await client.query(
      `INSERT INTO payments (user_id, amount, currency, payment_provider, payment_id, plan_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, amountPaid, currency, 'stripe', session.id, planType, 'completed']
    );

    // Update or insert user tokens (internal tracking only - NO user-facing queries)
    await client.query(
      `INSERT INTO user_tokens (user_id, liaison_tokens, last_updated)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET liaison_tokens = user_tokens.liaison_tokens + $2, last_updated = NOW()`,
      [userId, liaisonTokens]
    );

    // Audit log for internal tracking
    await client.query(
      `INSERT INTO audit_logs (user_id, action, details, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        userId,
        'token_swap',
        JSON.stringify({
          amount_paid: amountPaid,
          currency: currency,
          liaison_tokens: liaisonTokens,
          exchange_rate: exchangeRate,
          plan_type: planType,
          payment_provider: 'stripe',
          payment_id: session.id
        }),
      ]
    );

    await client.query('COMMIT');
    console.log(`Payment processed for user ${userId}: ${amountPaid} ${currency} -> ${liaisonTokens} LIAISON tokens`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
