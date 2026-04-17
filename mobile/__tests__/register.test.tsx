/**
 * RegisterScreen component test.
 *
 * Register uses an inline `error` state instead of Alert, so assertions
 * just check that the error message appears in the rendered output.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRegister = jest.fn();
jest.mock('@/lib/stores', () => ({
  useAuthStore: (selector: (s: { register: jest.Mock }) => unknown) =>
    selector({ register: mockRegister }),
}));

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

jest.mock('@/lib/apiErrors', () => ({
  describeApiError: (_e: unknown, fallback: string) => fallback,
}));

import RegisterScreen from '@/app/(auth)/register';

describe('<RegisterScreen />', () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
  });

  it('blocks submission when email or password missing', () => {
    const { getByRole, queryByText } = render(<RegisterScreen />);
    fireEvent.press(getByRole('button', { name: /Create Account|Creating/ }));
    expect(queryByText('Email and password required')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('blocks submission when password shorter than 8 chars', () => {
    const { getByPlaceholderText, getByRole, queryByText } = render(<RegisterScreen />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'short');
    fireEvent.press(getByRole('button', { name: /Create Account|Creating/ }));
    expect(queryByText('Password must be at least 8 characters')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('trims + lowercases email, passes display name when set', async () => {
    mockRegister.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByRole } = render(<RegisterScreen />);
    fireEvent.changeText(getByPlaceholderText('Email'), '  Todd@Example.COM  ');
    fireEvent.changeText(getByPlaceholderText('Password'), 'longenoughpw');
    fireEvent.changeText(getByPlaceholderText('Display Name (optional)'), '  Todd  ');
    fireEvent.press(getByRole('button', { name: /Create Account|Creating/ }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('todd@example.com', 'longenoughpw', 'Todd');
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/tasks');
  });

  it('omits display name when only whitespace', async () => {
    mockRegister.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByRole } = render(<RegisterScreen />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'longenoughpw');
    fireEvent.changeText(getByPlaceholderText('Display Name (optional)'), '   ');
    fireEvent.press(getByRole('button', { name: /Create Account|Creating/ }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('a@b.com', 'longenoughpw', undefined);
    });
  });

  it('shows the describeApiError fallback on failure', async () => {
    mockRegister.mockRejectedValue(new Error('boom'));
    const { getByPlaceholderText, getByRole, findByText } = render(<RegisterScreen />);
    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'longenoughpw');
    fireEvent.press(getByRole('button', { name: /Create Account|Creating/ }));

    expect(await findByText('Registration failed. Try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('navigates back when the sign-in link is pressed', () => {
    const { getByText } = render(<RegisterScreen />);
    fireEvent.press(getByText(/Sign In/i));
    expect(mockBack).toHaveBeenCalled();
  });
});
