"""OTP delivery.

The login code is generated and stored by the auth blueprint; how it reaches
the phone is decided here. WAULT ships without an SMS gateway on purpose —
the public demo would otherwise burn someone's SMS credit — so `deliver_otp`
reports that nothing was sent and the caller falls back to returning the code
in the API response (demo mode) or logging it.

Adding a real provider means implementing this one function (MSG91, Twilio,
SNS, ...) and returning True once the gateway accepts the message. The routes,
the response shape and the client do not change: as soon as this returns True,
`dev_otp` stops travelling in the response and the app never shows the code.
"""

from flask import current_app


def deliver_otp(mobile: str, code: str) -> bool:
    """Send a login code by SMS. Returns True when a gateway accepted it.

    Not implemented yet: there is no provider configured, so this always returns
    False and the caller decides how to expose the code instead.
    """
    current_app.logger.debug("SMS delivery is not configured for %s", mobile)
    return False
