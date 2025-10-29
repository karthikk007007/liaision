import crypto from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSignature = req.headers['x-razorpay-signature'];
  const webhookBody = JSON.stringify(req.body);

  try {
    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    if (webhookSignature !== expectedSignature) {
      console.error('Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Webhook signature verification error:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  const event = req.body;

  // Handle payment captured event
  if (event.event === 'payment.captured') {
    const payment = event.payload.payment.entity;
    
    try {
      await processPaymentSuccess(payment);
      return res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('Error processing payment:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(200).json({ status: 'success' });
}

async function processPaymentSuccess(payment) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const userId = payment.notes?.userId || payment.email;
    const amountPaid = payment.amount / 100; // Convert from paise to rupees
    const currency = payment.currency?.toUpperCase() || 'INR';
    const planType = payment.notes?.planType || 'unknown';
    
    // Calculate LIAISON tokens based on exchange rate
    const exchangeRate = parseFloat(process.env.LIAISON_TOKEN_EXCHANGE_RATE) || 1;
    const liaisonTokens = amountPaid * exchangeRate;

    // Insert payment record
    await client.query(
      `INSERT INTO payments (user_id, amount, currency, payment_provider, payment_id, plan_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [userId, amountPaid, currency, 'razorpay', payment.id, planType, 'completed']
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
          payment_provider: 'razorpay',
          payment_id: payment.id,
          order_id: payment.order_id
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
