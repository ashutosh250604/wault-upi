import React, { useState, useEffect, useRef } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation
} from "react-router-dom";

import { Scanner } from "@yudiel/react-qr-scanner";
import { QRCodeCanvas } from 'qrcode.react';

// Production builds are served from the same origin as the API (single deploy),
// so the base is empty there and points at Flask during local development.
const APIBASE = import.meta.env.VITE_API_BASE ?? "";

const api = (path) => `${APIBASE}${path}`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders() {
  return { "Content-Type": "application/json", ...authHeaders() };
}

function storeSession({ token, user_id, mobile, name, vpa }) {
  if (token) localStorage.setItem("token", token);
  if (user_id) localStorage.setItem("user_id", user_id);
  if (mobile) localStorage.setItem("mobile", mobile);
  if (name) localStorage.setItem("name", name);
  if (vpa) localStorage.setItem("vpa", vpa);
}

function ProtectedRoute({ children }) {
  const user_id = localStorage.getItem("user_id");
  if (!user_id) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function InputField({ label, type = "text", value, setValue, maxLength, error, showEye, showPin, setShowPin, isValid, checkmark }) {
  return (
    <div style={{ marginBottom: 20, position: "relative" }}>
      <label style={styles.label}>{label}</label>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={e => {
          let val = e.target.value;
          if (label === "Mobile Number") {
            val = val.replace(/\D/g, '').slice(0, maxLength || 10);
          }
          setValue(val);
        }}
        style={{
          ...styles.input,
          borderColor: error ? "#e74c3c" : "#ccc",
          paddingRight: showEye ? 38 : (checkmark ? 32 : 14)
        }}
      />
      {showEye && (
        <span
          onClick={() => setShowPin(prev => !prev)}
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            cursor: "pointer",
            fontSize: 17,
            userSelect: "none"
          }}
          tabIndex={0}
          aria-label={showPin ? "Hide PIN" : "Show PIN"}
          role="button"
        >
          {showPin ? "👁️" : "🙈"}
        </span>
      )}
      {checkmark && isValid && (
        <span style={{ position: "absolute", right: 12, top: 12, color: "#27ae60", fontSize: 17 }}>✔️</span>
      )}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [mobileError, setMobileError] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const isValidMobile = /^[6-9]\d{9}$/.test(mobile);

  async function handleLogin() {
    setMobileError("");
    if (!isValidMobile) {
      setMobileError("Enter a valid Indian mobile number");
      return;
    }
    try {
      const res = await fetch(api("/start_login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("mobile", mobile);
        if (data.dev_otp) localStorage.setItem("dev_otp", data.dev_otp);
        else localStorage.removeItem("dev_otp");
        navigate("/verify-otp");
      } else {
        setMobileError(data.message || "Failed to send OTP");
      }
    } catch {
      setMobileError("Network error, check backend status.");
    }
  }

  async function handleDemoLogin() {
    setMobileError("");
    setDemoBusy(true);
    try {
      const res = await fetch(api("/demo_login"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMobileError(data.message || "Demo account is unavailable");
        return;
      }
      storeSession(data);
      navigate("/home");
    } catch {
      setMobileError("Network error, check backend status.");
    } finally {
      setDemoBusy(false);
    }
  }

  useEffect(() => {
    setMobileError("");
  }, [mobile]);

  return (
    <CenteredCard>
      <h1 style={styles.title}>Welcome to UPI Wallet</h1>
      <InputField
        label="Mobile Number"
        value={mobile}
        setValue={setMobile}
        maxLength={10}
        error={mobileError}
        isValid={isValidMobile}
        checkmark={true}
      />
      <button
        disabled={!isValidMobile}
        style={{
          ...styles.primaryButton,
          backgroundColor: isValidMobile ? "#3e64ff" : "#eee",
          color: isValidMobile ? "#fff" : "#666",
          cursor: isValidMobile ? "pointer" : "not-allowed"
        }}
        onClick={handleLogin}
      >
        Send OTP
      </button>
      <button
        disabled={demoBusy}
        onClick={handleDemoLogin}
        style={{
          ...styles.primaryButton,
          marginTop: 12,
          backgroundColor: "#fff",
          color: "#3e64ff",
          border: "1.5px solid #3e64ff",
          boxShadow: "none",
          cursor: demoBusy ? "wait" : "pointer",
        }}
      >
        {demoBusy ? "Opening demo..." : "Explore demo account"}
      </button>
      <p style={{ color: "#8a97a8", fontSize: 13, marginTop: 12 }}>
        Demo mode: skip the OTP and explore a seeded wallet with history.
      </p>
    </CenteredCard>
  );
}

function VerifyOtpPage() {
  const navigate = useNavigate();
  const mobile = localStorage.getItem("mobile") || "";
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [info, setInfo] = useState("");
  const [timer, setTimer] = useState(30);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [devOtp, setDevOtp] = useState("");
  const inputRef = useRef();
  const verifyTimeoutRef = useRef(null);
  const isValidOtp = /^\d{6}$/.test(otp);

  // Log mobile once when component mounts for debugging
  useEffect(() => {
    console.log("Mobile from localStorage before OTP verify:", mobile);
    setDevOtp(localStorage.getItem("dev_otp") || "");
  }, [mobile]);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  useEffect(() => {
    setOtpError("");
  }, [otp]);

  useEffect(() => {
    if (isValidOtp && !isVerifying && !verified) {
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
      verifyTimeoutRef.current = setTimeout(() => {
        setIsVerifying(true);
        verifyOtp().finally(() => setIsVerifying(false));
      }, 500);
    }
  }, [otp, isValidOtp, isVerifying, verified]);

  async function resendOtp() {
    setOtp("");
    setInfo("");
    setOtpError("");
    setTimer(30);
    try {
      const res = await fetch(api("/start_login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.dev_otp) {
          localStorage.setItem("dev_otp", data.dev_otp);
          setDevOtp(data.dev_otp);
          setOtp(data.dev_otp);
        }
        setInfo("OTP resent! Check backend logs for OTP.");
      } else {
        setOtpError(data.message || "Failed to resend OTP");
      }
    } catch {
      setOtpError("Network error");
    }
  }

  async function verifyOtp() {
    setOtpError("");
    try {
      const res = await fetch(api("/verify_otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, otp }),
      });
      const data = await res.json();
      console.log("OTP verify response:", data);
      if (res.ok) {
        setVerified(true);
        storeSession(data);
        if (!data.user_id) {
          const userIdFetched = await fetchUserId();
          console.log("User ID fetched:", userIdFetched);
          if (!userIdFetched) {
            setOtpError("User ID fetch error");
            return;
          }
        }
        if (data.ask_name) {
          navigate("/set-name");
        } else {
          navigate("/home");
        }
      } else {
        setOtpError(data.message || "OTP verification failed");
        setOtp("");
        if (inputRef.current) inputRef.current.focus();
      }
    } catch (err) {
      console.error("OTP verify error:", err);
      setOtpError("Network error");
    }
  }

  async function fetchUserId() {
    try {
      const res = await fetch(
        api(`/get_user_id?mobile=${encodeURIComponent(mobile)}`),
        { headers: authHeaders() }
      );
      console.log("Fetch user ID raw response:", res);
      if (!res.ok) return null;
      const data = await res.json();
      console.log("Fetched user ID data:", data);
      localStorage.setItem("user_id", data.user_id);
      console.log("Stored user_id in localStorage");
      return true;
    } catch (err) {
      console.error("Fetch user ID error:", err);
      return null;
    }
  }

  return (
    <CenteredCard>
      <h1 style={styles.title}>Verify OTP</h1>
      {devOtp && (
        <div
          style={{
            background: "#eef3ff",
            border: "1px dashed #3e64ff",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 16,
            color: "#3e64ff",
            fontSize: 14,
          }}
        >
          Demo mode — your OTP is <b>{devOtp}</b>
          <button
            onClick={() => setOtp(devOtp)}
            style={{
              marginLeft: 10,
              border: "none",
              background: "#3e64ff",
              color: "#fff",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Fill
          </button>
        </div>
      )}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <input
          ref={inputRef}
          type="number"
          value={otp}
          maxLength={6}
          onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          style={{
            ...styles.input,
            letterSpacing: "6px",
            borderColor:
              otp.length === 0
                ? "#ccc"
                : isValidOtp
                ? "#27ae60"
                : otpError
                ? "#e74c3c"
                : "#ccc",
          }}
          autoFocus
        />
        {isValidOtp && (
          <span style={{ position: "absolute", right: 10, top: 12, color: "#27ae60" }}>
            ✔️
          </span>
        )}
        {otpError && <p style={styles.error}>{otpError}</p>}
      </div>
      <button
        disabled={timer > 0}
        onClick={resendOtp}
        style={{
          ...styles.primaryButton,
          width: "auto",
          padding: "8px 20px",
          backgroundColor: timer > 0 ? "#eee" : "#3e64ff",
          color: timer > 0 ? "#666" : "#fff",
          fontSize: 15,
          margin: 0,
          cursor: timer > 0 ? "not-allowed" : "pointer",
        }}
      >
        Resend OTP {timer > 0 ? `(${timer}s)` : ""}
      </button>
      {info && <p style={styles.info}>{info}</p>}
    </CenteredCard>
  );
}



function SetNamePage() {
  const navigate = useNavigate();
  const mobile = localStorage.getItem("mobile") || "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const isValidName = name.trim().length > 0;
  const isValidEmail = email.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Enable 'Next' button only if name is non-empty and email is valid or empty
  const canProceed = isValidName && isValidEmail;

  function validateInputs() {
    if (!isValidName) setNameError("Name cannot be empty");
    else setNameError("");
    if (!isValidEmail) setEmailError("Email is invalid");
    else setEmailError("");
  }

  async function handleNext() {
    validateInputs();
    if (!canProceed) return;
    try {
      const res = await fetch(api("/set_name"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ mobile, name, email }),
      });
      if (res.ok) {
        const data = await res.json();
        storeSession({ user_id: data.user_id, name, vpa: data.vpa });
        navigate("/set-pin");
      } else {
        const data = await res.json();
        setNameError(data.message || "Failed to save data");
      }
    } catch {
      setNameError("Network error");
    }
  }

  return (
    <CenteredCard>
      <h1 style={styles.title}>Complete Registration</h1>
      <InputField
        label="Your Name"
        value={name}
        setValue={setName}
        error={nameError}
        isValid={isValidName}
        checkmark={true}
      />
      <InputField
        label="Email (optional)"
        type="email"
        value={email}
        setValue={setEmail}
        error={emailError}
        isValid={isValidEmail}
        checkmark={email.length > 0 && isValidEmail}
      />
      <button
        disabled={!canProceed}
        style={{
          ...styles.primaryButton,
          backgroundColor: canProceed ? "#3e64ff" : "#eee",
          color: canProceed ? "#fff" : "#666",
          cursor: canProceed ? "pointer" : "not-allowed",
        }}
        onClick={handleNext}
      >
        Next
      </button>
    </CenteredCard>
  );
}


function SetPinPage() {
  const navigate = useNavigate();
  const mobile = localStorage.getItem("mobile") || "";
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const isValidPin = /^\d{4}$/.test(pin);

  // Auto-submit on full and valid PIN entry
  useEffect(() => {
    if (isValidPin) {
      savePin();
    }
    // eslint-disable-next-line
  }, [pin]);

  async function savePin() {
    setPinError("");
    try {
      const res = await fetch(api("/set_pin"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ mobile, pin }),
      });
      if (res.ok) {
        navigate("/home");
      } else {
        const data = await res.json();
        setPinError(data.message || "Failed to set PIN");
        setPin("");
      }
    } catch {
      setPinError("Network error");
    }
  }

  return (
    <CenteredCard>
      <h1 style={styles.title}>Set 4-digit PIN</h1>
      <InputField
        label="PIN"
        value={pin}
        setValue={(val) => setPin(val.replace(/\D/g, "").slice(0, 4))}
        maxLength={4}
        error={pinError}
        // No eye icon here — pin visible by default as requested
      />
    </CenteredCard>
  );
}

function PinModal({ onClose, onVerify }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    if (pin.length === 4) {
      handleVerify();
    }
  }, [pin]);

  async function handleVerify() {
    if (pin.length !== 4) {
      setError("Please enter 4 digit PIN");
      return;
    }
    const valid = await onVerify(pin);
    if (!valid) {
      // Show error but do NOT close modal
      setError("Incorrect PIN, please try again");
      setPin("");
    } else {
      setError("");
      onClose();
    }
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <h2>Enter 4-digit PIN</h2>
        <div style={{ position: "relative" }}>
          <input
            type={showPin ? "text" : "password"}
            maxLength={4}
            autoFocus
            style={styles.input}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <span
            onClick={() => setShowPin(!showPin)}
            style={{ position: "absolute", right: 10, top: 10, cursor: "pointer", fontSize: 17 }}
            tabIndex={0}
            aria-label={showPin ? "Hide PIN" : "Show PIN"}
            role="button"
          >
            {showPin ? "👁" : "🙈"}
          </span>
        </div>
        {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
        <button style={{ ...styles.primaryButton, marginTop: 16, backgroundColor: "#ccc" }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}


function HomePage() {
  const [showPinModal, setShowPinModal] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  async function verifyPin(pin) {
    const mobile = localStorage.getItem("mobile");
    if (!mobile) return false;
    try {
      const res = await fetch(api("/verify_pin"), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ mobile, pin }),
      });
      if (res.ok) {
        navigate("/balance");
        return true;
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  return (
    <CenteredCard>
      <h1 style={styles.title}>Wallet Home</h1>
      <button style={styles.primaryButton} onClick={() => setShowPinModal(true)}>
        Check Balance
      </button>
      <div style={styles.buttonGrid}>
        <button style={styles.bigButton} onClick={() => navigate("/scan-qr")}>Scan QR</button>

        <button style={styles.bigButton} onClick={() => navigate("/show-qr")}>Show QR</button>
      </div>
      <button
        style={{ ...styles.primaryButton, marginTop: 20, backgroundColor: "#e74c3c" }}
        onClick={handleLogout}
      >
        Logout
      </button>
      {showPinModal && (
        <PinModal
          onClose={() => setShowPinModal(false)}
          onVerify={verifyPin}
        />
      )}
    </CenteredCard>
  );
}

function BalancePage() {
  const navigate = useNavigate();
  const user_id = localStorage.getItem("user_id");
  const [balance, setBalance] = React.useState(null);
  const [transactions, setTransactions] = React.useState([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    async function fetchData() {
      try {
        const balanceRes = await fetch(api(`/get_balance/${user_id}`), {
          headers: authHeaders(),
        });
        const balanceData = await balanceRes.json();
        if (!balanceRes.ok) throw new Error(balanceData.message || "Balance fetch failed");
        setBalance(balanceData.balance);

        const transRes = await fetch(api(`/transactions/${user_id}`), {
          headers: authHeaders(),
        });
        const transData = await transRes.json();
        if (!transRes.ok) throw new Error("Transactions fetch failed");
        setTransactions(transData);
        setError("");
      } catch (err) {
        setError(err.message);
      }
    }

    fetchData();
  }, [user_id]);

  const handleTopUpClick = () => {
    navigate("/amount-entry", {
      state: {
        recipientName: "Self",
        recipientUpiId:
          localStorage.getItem("vpa") ||
          `${localStorage.getItem("mobile")}@demoupi`,
        isTopUp: true,
      },
    });
  };

  return (
    <CenteredCard>
      <button
        style={{ ...styles.primaryButton, marginBottom: 16 }}
        onClick={() => navigate(-1)}
      >
        Back
      </button>

      <h1 style={styles.title}>Your Wallet</h1>

      {error && <p style={styles.error}>{error}</p>}

      {balance != null && <h2>Balance: ₹{balance.toFixed(2)}</h2>}

      <button onClick={handleTopUpClick} style={styles.primaryButton}>
        Top Up
      </button>

      <h3>Transaction History</h3>

      <div style={styles.transList}>
        {transactions.length === 0 ? (
          <p>No transactions yet.</p>
        ) : (
          transactions.map((t) => {
            return (
              <div key={t.id || Math.random()} style={styles.transItem}>
                <div>
                  <strong>{t.type.toUpperCase()}</strong> - {t.amount}
                </div>
                {t.type === "transfer" && (
                  <div>
                    {t.sender_name && <span>From: {t.sender_name}</span>} {t.receiver_name && <span>To: {t.receiver_name}</span>}
                  </div>
                )}
                <div>{new Date(t.timestamp).toLocaleString()}</div>
              </div>
            );
          })
        )}
      </div>
    </CenteredCard>
  );
}




function ScanQRPage() {
  const navigate = useNavigate();
  const [error, setError] = React.useState(null);
  const [hasCamera, setHasCamera] = React.useState(true);
  const [checkedCamera, setCheckedCamera] = React.useState(false);
  const [permissionAsked, setPermissionAsked] = React.useState(false);
  const [manualVpa, setManualVpa] = React.useState("");
  const [manualError, setManualError] = React.useState("");

React.useEffect(() => {
  if (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  ) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((stream) => {
        setHasCamera(true);
        setCheckedCamera(true);
        setPermissionAsked(true);
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(() => {
        setError("Camera permission denied or not available. Please allow camera access in your browser settings.");
        setHasCamera(false);
        setCheckedCamera(true);
        setPermissionAsked(true);
      });
  } else {
    setError("Camera API not supported in this browser. Please use Chrome (Android) or Safari (iOS) and avoid incognito/private mode.");
    setHasCamera(false);
    setCheckedCamera(true);
    setPermissionAsked(true);
  }
}, []);

  function goToAmount(upiId) {
    navigate("/amount-entry", {
      state: {
        recipientName: "",
        recipientUpiId: upiId,
        isTopUp: false,
      },
    });
  }

  function handleScan(data) {
    if (data) goToAmount(data);
  }

  // Camera-free fallback: pay any UPI-style ID by typing it in.
  function handleManualSubmit() {
    const value = manualVpa.trim();
    if (!value.includes("@")) {
      setManualError("Enter a UPI ID like 9000000002@demoupi");
      return;
    }
    setManualError("");
    goToAmount(value);
  }

  function handleError(err) {
    setError(
      err?.message ||
        "Camera error. The camera needs a secure HTTPS link — check permissions or type the UPI ID instead."
    );
    setHasCamera(false);
  }

  if (!hasCamera && checkedCamera) {
    return (
      <CenteredCard>
        <p style={{ color: "red" }}>
          {error || "No camera detected. Please use a device with a camera and allow camera access."}
        </p>
        <p style={{ color: "#888", marginTop: 10 }}>
          If you see a blank page or no camera prompt, please use Chrome (Android) or Safari (iOS) and open the app over HTTPS.<br />
          Also check browser settings and manually allow camera access for this site.
        </p>
        <div style={{ marginTop: 24, textAlign: "left" }}>
          <label style={styles.label}>Pay by UPI ID</label>
          <input
            value={manualVpa}
            onChange={(e) => setManualVpa(e.target.value.trim())}
            placeholder="9000000002@demoupi"
            style={{ ...styles.input, marginBottom: 10 }}
          />
          {manualError && <p style={styles.error}>{manualError}</p>}
          <button style={styles.primaryButton} onClick={handleManualSubmit}>
            Continue
          </button>
        </div>
        <button style={styles.primaryButton} onClick={() => navigate("/home")}> 
          Go Back Home
        </button>
      </CenteredCard>
    );
  }

  // Only render QrReader after permission is asked
  if (!permissionAsked) {
    return (
      <CenteredCard>
        <p style={{ color: "#888" }}>Requesting camera permission...</p>
      </CenteredCard>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.8)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        color: "white",
      }}
    >
      <button
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "transparent",
          color: "white",
          fontSize: 24,
          border: "none",
          cursor: "pointer",
        }}
        onClick={() => navigate("/home")}
      >
        ✕
      </button>

      <div
        style={{
          width: 320,
          height: 320,
          border: "2px solid #3e64ff",
          borderRadius: 16,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Scanner
          constraints={{ facingMode: "environment" }}
          onScan={(codes) => {
            const value = codes?.[0]?.rawValue;
            if (value) handleScan(value);
          }}
          onError={(err) => handleError(err)}
          // The blue frame below is drawn by this screen, so the library's own
          // finder/torch chrome is switched off.
          components={{ finder: false, torch: false, onOff: false, zoom: false }}
          styles={{
            container: { width: "100%", height: "100%" },
            video: { width: "100%", height: "100%", objectFit: "cover" },
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            border: "4px solid #3e64ff",
            borderRadius: 16,
            boxSizing: "border-box",
            margin: 10,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, width: 320, marginTop: 20 }}>
        <input
          value={manualVpa}
          onChange={(e) => setManualVpa(e.target.value.trim())}
          placeholder="or type a UPI ID"
          style={{ ...styles.input, flex: 1 }}
        />
        <button
          onClick={handleManualSubmit}
          style={{ ...styles.primaryButton, width: 88, marginTop: 0, padding: "10px 0", fontSize: 15 }}
        >
          Pay
        </button>
      </div>
      {manualError && <p style={{ color: "#ffb3b3", marginTop: 6 }}>{manualError}</p>}
      <p style={{ marginTop: 16 }}>Scan QR code to pay</p>
      {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
      <p style={{ color: "#888", marginTop: 10, fontSize: 13 }}>
        If you see a blank page or no camera prompt, please use Chrome (Android) or Safari (iOS) and open the app over HTTPS — or type the UPI ID above.
      </p>
    </div>
  );
}




function ShowQRPage() {
  const [user, setUser] = useState({ mobile: "", name: "", vpa: "" });
  const navigate = useNavigate();

  useEffect(() => {
    const mobile = localStorage.getItem("mobile") || "";
    const name = localStorage.getItem("name") || "";
    const vpa = localStorage.getItem("vpa") || `${mobile}@demoupi`;
    setUser({ mobile, name, vpa });
  }, []);

  const upiId = user.vpa || `${user.mobile}@demoupi`;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(user.name)}`;

  return (
    <div style={{
      ...styles.pageContainer,
      backgroundColor: '#f6f9fe',
      flexDirection: 'column'
    }}>
      <div style={{
        ...styles.card,
        maxWidth: 340,
        padding: 24,
        textAlign: 'center',
        borderRadius: 16,
        boxShadow: "0 20px 40px rgb(0 0 0 / 10%)",
        backgroundColor: 'white',
      }}>
        <h2 style={{ marginBottom: 8, fontWeight: '700', color: '#131921' }}>Your QR Code</h2>
        <p style={{ marginBottom: 16, color: '#677685', fontSize: 16 }}>Scan this QR to pay you via UPI</p>
        <QRCodeCanvas value={upiLink} size={200} />
        <p style={{
          marginTop: 16,
          fontWeight: '600',
          fontSize: 18,
          color: '#131921',
          userSelect: 'all',
        }}>{upiId}</p>
      </div>
      <button onClick={() => navigate('/home')} style={{ ...styles.primaryButton, marginTop: 20, width: 200 }}>
        Go Back Home
      </button>
    </div>
  );
}

function CenteredCard({ children }) {
  return (
    <div style={styles.pageContainer}>
      <div style={styles.card}>{children}</div>
    </div>
  );
}

// AmountEntryPage Component
function AmountEntryPage({
  recipientName,
  recipientUpiId,
  onConfirm,
  avatarUrl,
  note = "",
  errorText = "",
  disabled = false,
}) {
  const [amount, setAmount] = React.useState("");

  function handleArrowClick() {
    if (disabled) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    onConfirm(amt);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      justifyContent: "center", alignItems: "center", background: "#fff",
      padding: 24,
    }}>
      {avatarUrl && (
        <img src={avatarUrl} alt="avatar" style={{ width: 60, height: 60, borderRadius: "50%", marginBottom: 20 }} />
      )}
      <h3>Paying {recipientName}</h3>
      <div style={{ color: "#888", fontSize: 15, marginBottom: 20 }}>{recipientUpiId}</div>
      <div style={{ fontWeight: 700, fontSize: 36, marginBottom: 20 }}>₹{amount || "0"}</div>
      <input
        type="number"
        placeholder="Enter amount"
        value={amount}
        onChange={e => setAmount(e.target.value.replace(/^0+(?!\.|$)/, ''))}
        style={{ fontSize: 24, padding: 8, width: 180, textAlign: "center", marginBottom: 10 }}
      />
      {errorText && (
        <div style={{ color: "#e74c3c", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
          {errorText}
        </div>
      )}
      <div style={{ color: "#888", fontSize: 13, marginBottom: 30 }}>{note}</div>
      <button
        onClick={handleArrowClick}
        disabled={disabled}
        style={{
          backgroundColor: disabled ? "#c7d2ff" : "#3e64ff",
          color: "white",
          borderRadius: "50%",
          width: 56,
          height: 56,
          fontSize: 28,
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: disabled ? "none" : "0 2px 8px #3e64ff66",
        }}
      >
        →
      </button>
    </div>
  );
}

// PaymentResultPage Component
function PaymentResultPage({
  amount,
  recipientName,
  recipientUpiId,
  txnId,
  success = true,
  failureReason = "",
}) {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center",
      flexDirection: "column", background: "#fff", padding: 24,
    }}>
      <div style={{
        backgroundColor: success ? "#e5f8e3" : "#f8d7da", borderRadius: "50%",
        width: 90, height: 90, display: "flex", justifyContent: "center", alignItems: "center",
        marginBottom: 24,
      }}>
        <span style={{ fontSize: 48, color: success ? "#27ae60" : "#a71d2a" }}>
          {success ? "✔" : "❌"}
        </span>
      </div>
      <h2 style={{ margin: 0 }}>{success ? "₹" + amount : "Payment Failed"}</h2>
      {success && <div>Paid to <b>{recipientName}</b></div>}
      {!success && (
        <div style={{ marginTop: 8, color: "#a71d2a" }}>
          {failureReason || "Transaction failed"}
        </div>
      )}
      <div style={{ color: "#888", fontSize: 13, marginTop: 12 }}>
        UPI ID: {recipientUpiId}
      </div>
      {success && txnId && (
        <div style={{ color: "#888", fontSize: 13, marginTop: 8 }}>
          Txn ID: {txnId}
        </div>
      )}
      <button
        style={{
          backgroundColor: "#3e64ff",
          color: "white",
          borderRadius: 10,
          fontWeight: 600,
          padding: "12px 0",
          fontSize: 18,
          border: "none",
          width: 180,
          cursor: "pointer",
          marginTop: 30,
        }}
        onClick={() => navigate("/home")}
      >
        Done
      </button>
    </div>
  );
}

// Wrapper components for routing that include PIN modal and payment logic

function AmountEntryPageWrapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recipientName, recipientUpiId, avatarUrl, note, isTopUp } = location.state || {};
  const [amount, setAmount] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [receiver, setReceiver] = useState(isTopUp ? { name: "yourself" } : null);
  const [resolveError, setResolveError] = useState("");

  // Resolve the scanned or typed UPI ID before the payer enters an amount,
  // so the app can show who is being paid (like popular UPI apps do).
  useEffect(() => {
    if (isTopUp || !recipientUpiId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(api("/vpas/resolve"), {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ vpa: recipientUpiId }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setResolveError(data.message || "Recipient not found");
          return;
        }
        setReceiver({ id: data.user_id, name: data.name });
      } catch {
        if (!cancelled) setResolveError("Network error while finding the recipient");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientUpiId, isTopUp]);

  function onAmountConfirm(amt) {
    setAmount(amt);
    setShowPinModal(true);
  }

  async function performTransaction(pin) {
    // Verify the PIN server-side before any money moves.
    const pinVerifyRes = await fetch(api("/verify_pin"), {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ pin, mobile: localStorage.getItem("mobile") }),
    });

    if (!pinVerifyRes.ok) {
      // Wrong PIN: keep the sheet open so the user can retry.
      return false;
    }

    let apiPath = "/topup";
    let body = { user_id: localStorage.getItem("user_id"), amount };
    if (!isTopUp) {
      if (!receiver?.id) return false;
      apiPath = "/transfer";
      body = { receiver_id: receiver.id, amount, note: note || undefined };
    }

    const paidTo = receiver?.name || recipientName || "Recipient";

    try {
      const res = await fetch(api(apiPath), {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setShowPinModal(false);

      if (res.ok) {
        navigate("/payment-result", {
          state: {
            recipientName: paidTo,
            recipientUpiId,
            amount,
            txnId: data.txn_id || "",
            success: true,
          },
        });
        return true;
      }

      navigate("/payment-result", {
        state: {
          recipientName: paidTo,
          recipientUpiId,
          amount,
          success: false,
          failureReason: data.message || "Transaction failed",
        },
      });
      return false;
    } catch {
      setShowPinModal(false);
      navigate("/payment-result", {
        state: {
          recipientName: paidTo,
          recipientUpiId,
          amount,
          success: false,
          failureReason: "Network error while processing the payment",
        },
      });
      return false;
    }
  }

  return (
    <>
      <AmountEntryPage
        recipientName={isTopUp ? "yourself" : receiver?.name || recipientName || "..."}
        recipientUpiId={recipientUpiId}
        avatarUrl={avatarUrl}
        note={note}
        onConfirm={onAmountConfirm}
        errorText={resolveError}
        disabled={!isTopUp && !receiver}
      />
      {showPinModal && <PinModal onClose={() => setShowPinModal(false)} onVerify={performTransaction} />}
    </>
  );
}


function PaymentResultPageWrapper() {
  const location = useLocation();
  const navigate = useNavigate();
  const { amount, recipientName, recipientUpiId, txnId, success, failureReason } =
    location.state || {};

  useEffect(() => {
    if (amount == null) navigate("/home", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  if (amount == null) {
    return null;
  }

  return (
    <PaymentResultPage
      amount={amount}
      recipientName={recipientName}
      recipientUpiId={recipientUpiId}
      txnId={txnId}
      success={success}
      failureReason={failureReason}
    />
  );
}



export default function App() {
  return (
    <Router>
      <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/verify-otp" element={<VerifyOtpPage />} />
          <Route path="/set-name" element={<ProtectedRoute><SetNamePage /></ProtectedRoute>} />
          <Route path="/set-pin" element={<ProtectedRoute><SetPinPage /></ProtectedRoute>} />
          <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/scan-qr" element={<ProtectedRoute><ScanQRPage /></ProtectedRoute>} />
          <Route path="/balance" element={<ProtectedRoute><BalancePage /></ProtectedRoute>} />
          <Route path="/show-qr" element={<ProtectedRoute><ShowQRPage /></ProtectedRoute>} />
          <Route path="/amount-entry" element={<ProtectedRoute><AmountEntryPageWrapper /></ProtectedRoute>} />
          <Route path="/payment-result" element={<ProtectedRoute><PaymentResultPageWrapper /></ProtectedRoute>} />
      </Routes>
    </Router>
  );
}

const styles = {
  pageContainer: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #e0ecf5, #f8f9fc)",
    padding: 20,
  },
  card: {
    background: "white",
    padding: 30,
    borderRadius: 16,
    boxShadow: "0 15px 30px rgb(0 0 0 / 10%)",
    width: "100%",
    maxWidth: 400,
    boxSizing: "border-box",
    textAlign: "center",
  },
  title: {
    fontWeight: "bold",
    fontSize: 28,
    marginBottom: 30,
    color: "#243746",
  },
  label: {
    display: "block",
    marginBottom: 6,
    fontWeight: "600",
    color: "#40526f",
  },
  input: {
    width: "100%",
    padding: "10px 14px",
    fontSize: 16,
    borderRadius: 8,
    border: "1.5px solid #e1e8f1",
    outline: "none",
    transition: "border-color 0.2s",
    boxSizing: "border-box",
    fontWeight: "400",
  },
  primaryButton: {
    backgroundColor: "#3e64ff",
    color: "white",
    borderRadius: 10,
    fontWeight: "600",
    padding: "12px 0",
    fontSize: 18,
    border: "none",
    width: "100%",
    cursor: "pointer",
    boxShadow:
      "0 10px 20px rgb(105 95 241 / 0.51), inset 0 0 50px rgb(105 95 241 / 0.3)",
    transition: "all 0.3s ease",
    marginTop: 10,
  },
  link: {
    color: "#3e64ff",
    cursor: "pointer",
    marginTop: 16,
    userSelect: "none",
  },
  error: {
    color: "#e74c3c",
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 0
  },
  info: {
    color: "#27ae60",
    fontWeight: "600",
    marginTop: 6,
  },
  buttonGrid: {
    display: "flex",
    justifyContent: "space-around",
    marginTop: 40,
  },
  bigButton: {
    backgroundColor: "#3e64ff",
    color: "white",
    borderRadius: "20px",
    height: 140,
    width: 140,
    fontSize: 20,
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    boxShadow:
      "0px 10px 50px rgba(62, 100, 255, 0.4), inset 0px 0px 30px rgba(62, 100, 255, 0.3)",
    transition: "transform 0.3s ease",
  },
  transList: {
    maxHeight: 280,
    overflowY: "auto",
    marginTop: 10,
    textAlign: "left",
  },
  transItem: {
    padding: 14,
    borderBottom: "1px solid #eee",
    fontSize: 14,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: 9999,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    padding: 24,
    borderRadius: 16,
    width: 320,
    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
    textAlign: "center",
  },
};
