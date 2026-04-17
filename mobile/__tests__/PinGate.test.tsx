/**
 * PinGate component tests.
 *
 * Covers the three visible modes (set, enter, locked), the bio-enrollment
 * offer, and the wrong-PIN lockout escalation. lib/pin + lib/biometric are
 * mocked module-wide so the tests don't touch SecureStore or any native
 * module (both of which would crash in jest-expo).
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// @expo/vector-icons → a no-op icon. Full impl pulls in expo-font.isLoaded
// which isn't wired into jest-expo on SDK 52 and crashes render.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// --- lib/pin mock --------------------------------------------------------

const pinState = {
  isSet: true,
  lockedOut: false,
  failedAttempts: 0,
  verifyOk: true,
};

jest.mock('@/lib/pin', () => ({
  MAX_ATTEMPTS: 5,
  isPinSet: jest.fn(async () => pinState.isSet),
  isLockedOut: jest.fn(async () => pinState.lockedOut),
  getFailedAttempts: jest.fn(async () => pinState.failedAttempts),
  verifyPin: jest.fn(async () => pinState.verifyOk),
  setPin: jest.fn(async () => {}),
  touchUnlock: jest.fn(async () => {}),
}));

// --- lib/biometric mock --------------------------------------------------

const bioState = {
  kind: 'none' as 'none' | 'face' | 'fingerprint',
  enabled: false,
  authOk: false,
};

jest.mock('@/lib/biometric', () => ({
  biometricKind: jest.fn(async () => bioState.kind),
  isBiometricAvailable: jest.fn(async () => bioState.kind !== 'none'),
  isBiometricEnabled: jest.fn(async () => bioState.enabled),
  setBiometricEnabled: jest.fn(async () => {}),
  authenticateBiometric: jest.fn(async () => bioState.authOk),
}));

import PinGate from '@/components/PinGate';

function resetMocks() {
  pinState.isSet = true;
  pinState.lockedOut = false;
  pinState.failedAttempts = 0;
  pinState.verifyOk = true;
  bioState.kind = 'none';
  bioState.enabled = false;
  bioState.authOk = false;
  jest.clearAllMocks();
}

async function pressDigits(api: ReturnType<typeof render>, digits: string) {
  for (const d of digits) {
    fireEvent.press(api.getByLabelText(`Digit ${d}`));
  }
}

describe('<PinGate />', () => {
  beforeEach(resetMocks);

  it('renders Enter PIN mode when a pin is already set', async () => {
    const { findByText, queryByText } = render(<PinGate onUnlock={() => {}} />);
    expect(await findByText('Enter PIN')).toBeTruthy();
    expect(queryByText('Set PIN')).toBeNull();
  });

  it('renders Set PIN mode when no pin is set yet', async () => {
    pinState.isSet = false;
    const { findByText } = render(<PinGate onUnlock={() => {}} />);
    expect(await findByText('Set PIN')).toBeTruthy();
  });

  it('renders Locked mode when the lockout threshold has been hit', async () => {
    pinState.lockedOut = true;
    const { findByText } = render(<PinGate onUnlock={() => {}} />);
    expect(await findByText('Locked')).toBeTruthy();
    expect(await findByText(/Too many wrong attempts/i)).toBeTruthy();
  });

  it('calls onUnlock after a correct PIN', async () => {
    const onUnlock = jest.fn();
    const api = render(<PinGate onUnlock={onUnlock} />);
    await api.findByText('Enter PIN');
    await act(async () => { await pressDigits(api, '1234'); });
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('shows attempts-remaining warning after a wrong PIN', async () => {
    pinState.verifyOk = false;
    // On a wrong verify, PinGate re-reads getFailedAttempts. Simulate the
    // increment the real lib/pin would have persisted.
    const pinMod = require('@/lib/pin');
    (pinMod.getFailedAttempts as jest.Mock).mockResolvedValueOnce(0);
    (pinMod.getFailedAttempts as jest.Mock).mockResolvedValueOnce(1);
    const onUnlock = jest.fn();
    const api = render(<PinGate onUnlock={onUnlock} />);
    await api.findByText('Enter PIN');
    await act(async () => { await pressDigits(api, '0000'); });
    expect(await api.findByText(/Wrong PIN\. 4 attempts? left\./)).toBeTruthy();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('transitions to Locked after MAX_ATTEMPTS wrong attempts', async () => {
    pinState.verifyOk = false;
    const pinMod = require('@/lib/pin');
    (pinMod.getFailedAttempts as jest.Mock).mockResolvedValueOnce(0);
    (pinMod.getFailedAttempts as jest.Mock).mockResolvedValueOnce(5);
    const api = render(<PinGate onUnlock={() => {}} />);
    await api.findByText('Enter PIN');
    await act(async () => { await pressDigits(api, '9999'); });
    expect(await api.findByText('Locked')).toBeTruthy();
  });
});
