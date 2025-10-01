const paypal = require('@paypal/checkout-server-sdk');

// PayPal environment setup
const environment = process.env.NODE_ENV === 'production' 
  ? new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  : new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID || 'AYsyYdQahuNZ_bDW4ZgzCaL6qmxXr5N1dcAUsjiNBP4-8aqX3A7yeTmqABe6rKwHnmFaVa9w9Nqhz4UG',
      process.env.PAYPAL_CLIENT_SECRET || 'EGnHDxD_qRPdaLdHGkioDr4XigtWcgLIuLiuqiXzOKxFqA8xIw4A-6BvkuFG6NYJ7v8A8k_nxGQH6VBF'
    );

const client = new paypal.core.PayPalHttpClient(environment);

class PayPalService {
  // إنشاء دفعة PayPal
  async createPayment(amount, currency = 'USD', description = 'Scooter Ride Payment') {
    try {
      const request = new paypal.orders.OrdersCreateRequest();
      request.prefer("return=representation");
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: currency,
            value: amount.toFixed(2)
          },
          description: description
        }],
        application_context: {
          return_url: `${process.env.BASE_URL || 'http://localhost:5000'}/api/payments/paypal/success`,
          cancel_url: `${process.env.BASE_URL || 'http://localhost:5000'}/api/payments/paypal/cancel`,
          brand_name: 'Scooter App',
          landing_page: 'BILLING',
          user_action: 'PAY_NOW'
        }
      });

      const order = await client.execute(request);
      
      return {
        success: true,
        orderId: order.result.id,
        approvalUrl: order.result.links.find(link => link.rel === 'approve').href,
        order: order.result
      };
    } catch (error) {
      console.error('PayPal create payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // تأكيد الدفعة
  async capturePayment(orderId) {
    try {
      const request = new paypal.orders.OrdersCaptureRequest(orderId);
      request.requestBody({});

      const capture = await client.execute(request);
      
      return {
        success: true,
        captureId: capture.result.purchase_units[0].payments.captures[0].id,
        status: capture.result.status,
        amount: capture.result.purchase_units[0].payments.captures[0].amount,
        capture: capture.result
      };
    } catch (error) {
      console.error('PayPal capture payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // استرداد الدفعة
  async refundPayment(captureId, amount, currency = 'USD') {
    try {
      const request = new paypal.payments.CapturesRefundRequest(captureId);
      request.requestBody({
        amount: {
          currency_code: currency,
          value: amount.toFixed(2)
        }
      });

      const refund = await client.execute(request);
      
      return {
        success: true,
        refundId: refund.result.id,
        status: refund.result.status,
        amount: refund.result.amount,
        refund: refund.result
      };
    } catch (error) {
      console.error('PayPal refund error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // التحقق من حالة الدفعة
  async getPaymentDetails(orderId) {
    try {
      const request = new paypal.orders.OrdersGetRequest(orderId);
      const order = await client.execute(request);
      
      return {
        success: true,
        order: order.result
      };
    } catch (error) {
      console.error('PayPal get payment details error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new PayPalService();