const paypal = require('@paypal/checkout-server-sdk');

// PayPal environment setup - استخدام البيانات الحقيقية من .env
const environment = process.env.NODE_ENV === 'production' 
  ? new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  : new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    );

const client = new paypal.core.PayPalHttpClient(environment);

// قاموس العملات المدعومة من PayPal
const SUPPORTED_CURRENCIES = {
  'USD': { name: 'US Dollar', symbol: '$' },
  'EUR': { name: 'Euro', symbol: '€' },
  'GBP': { name: 'British Pound', symbol: '£' },
  'SAR': { name: 'Saudi Riyal', symbol: 'ر.س' },
  'AED': { name: 'UAE Dirham', symbol: 'د.إ' },
  'EGP': { name: 'Egyptian Pound', symbol: 'ج.م' },
  'QAR': { name: 'Qatari Riyal', symbol: 'ر.ق' },
  'KWD': { name: 'Kuwaiti Dinar', symbol: 'د.ك' },
  'BHD': { name: 'Bahraini Dinar', symbol: 'د.ب' },
  'OMR': { name: 'Omani Rial', symbol: 'ر.ع' },
  'JOD': { name: 'Jordanian Dinar', symbol: 'د.أ' }
};

class PayPalService {
  // التحقق من دعم العملة
  isCurrencySupported(currency) {
    return SUPPORTED_CURRENCIES.hasOwnProperty(currency);
  }

  // تحويل العملة إلى USD إذا لم تكن مدعومة
  async convertCurrency(amount, fromCurrency, toCurrency = 'USD') {
    // في التطبيق الحقيقي، يجب استخدام API لتحويل العملات
    // هنا سنستخدم معدلات تقريبية للتطوير
    const exchangeRates = {
      'EGP': 0.032, // 1 EGP = 0.032 USD
      'SAR': 0.267, // 1 SAR = 0.267 USD
      'AED': 0.272, // 1 AED = 0.272 USD
      'QAR': 0.275, // 1 QAR = 0.275 USD
      'KWD': 3.25,  // 1 KWD = 3.25 USD
      'BHD': 2.65,  // 1 BHD = 2.65 USD
      'OMR': 2.60,  // 1 OMR = 2.60 USD
      'JOD': 1.41,  // 1 JOD = 1.41 USD
      'EUR': 1.08,  // 1 EUR = 1.08 USD
      'GBP': 1.25,  // 1 GBP = 1.25 USD
      'USD': 1.0    // 1 USD = 1.0 USD
    };

    if (fromCurrency === toCurrency) return amount;
    
    const rate = exchangeRates[fromCurrency] || 1;
    return amount * rate;
  }

  // إنشاء دفعة PayPal مع دعم العملات المختلفة
  async createPayment(amount, currency = 'USD', description = 'Wallet Top-up', userLocation = null) {
    try {
      // التحقق من دعم العملة
      let finalCurrency = currency;
      let finalAmount = amount;

      if (!this.isCurrencySupported(currency)) {
        // تحويل إلى USD إذا لم تكن العملة مدعومة
        finalAmount = await this.convertCurrency(amount, currency, 'USD');
        finalCurrency = 'USD';
        console.log(`Currency ${currency} not supported, converted ${amount} ${currency} to ${finalAmount} USD`);
      }

      const request = new paypal.orders.OrdersCreateRequest();
      request.prefer("return=representation");
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: finalCurrency,
            value: finalAmount.toFixed(2)
          },
          description: description,
          custom_id: `wallet_topup_${Date.now()}`,
          soft_descriptor: 'MOBILITY_WALLET'
        }],
        application_context: {
          return_url: `${process.env.BASE_URL || 'http://localhost:5001'}/api/payments/paypal/success`,
          cancel_url: `${process.env.BASE_URL || 'http://localhost:5001'}/api/payments/paypal/cancel`,
          brand_name: 'Micro Mobility Platform',
          landing_page: 'BILLING',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING'
        }
      });

      const order = await client.execute(request);
      
      return {
        success: true,
        orderId: order.result.id,
        approvalUrl: order.result.links.find(link => link.rel === 'approve').href,
        originalAmount: amount,
        originalCurrency: currency,
        finalAmount: finalAmount,
        finalCurrency: finalCurrency,
        order: order.result
      };
    } catch (error) {
      console.error('PayPal create payment error:', error);
      return {
        success: false,
        error: error.message || 'Failed to create PayPal payment'
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
        payer: capture.result.payer,
        capture: capture.result
      };
    } catch (error) {
      console.error('PayPal capture payment error:', error);
      return {
        success: false,
        error: error.message || 'Failed to capture PayPal payment'
      };
    }
  }

  // استرداد الدفعة
  async refundPayment(captureId, amount, currency = 'USD', reason = 'Customer request') {
    try {
      const request = new paypal.payments.CapturesRefundRequest(captureId);
      request.requestBody({
        amount: {
          currency_code: currency,
          value: amount.toFixed(2)
        },
        note_to_payer: reason
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
        error: error.message || 'Failed to process PayPal refund'
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
        error: error.message || 'Failed to get PayPal payment details'
      };
    }
  }

  // الحصول على العملات المدعومة
  getSupportedCurrencies() {
    return SUPPORTED_CURRENCIES;
  }
}

module.exports = new PayPalService();