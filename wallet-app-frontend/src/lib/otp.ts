/**
 * Where the login code comes from.
 *
 * WAULT deliberately ships without an SMS gateway: while none is
 * configured the API returns the code (`dev_otp`) so the flow is walkable, and
 * the verify screen shows it. The screen itself stays delivery-agnostic — it
 * asks this module what to say rather than checking `devOtp` inline. When the
 * server starts sending codes by SMS it stops returning `dev_otp`, and this
 * screen switches to the "sent by SMS" copy on its own.
 */

export type OtpDelivery = "sms" | "preview";

/** True once the API stops handing the code back: delivery is by SMS. */
export function otpDelivery(devOtp: string | null | undefined): OtpDelivery {
  return devOtp ? "preview" : "sms";
}

export interface OtpNotice {
  /** The code to display on screen, or null when it arrived by SMS. */
  previewCode: string | null;
  /** Leads the "where did it go" line under the heading. */
  destinationLabel: string;
  /** The one-line caveat under the digit boxes. */
  footnote: string;
}

export function otpNotice(devOtp: string | null | undefined): OtpNotice {
  const delivery = otpDelivery(devOtp);
  if (delivery === "sms") {
    return {
      previewCode: null,
      destinationLabel: "Sent to",
      footnote: "Three wrong attempts and you'll need a new code.",
    };
  }
  return {
    previewCode: devOtp ?? null,
    destinationLabel: "Code for",
    footnote: "This demo shows the code here instead of sending it by SMS.",
  };
}
