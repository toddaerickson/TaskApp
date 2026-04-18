/**
 * LoginScreen component test.
 *
 * Covers what the inline handler in app/(auth)/login.tsx actually does:
 *  - empty-field guard surfaces an inline error and doesn't call the store
 *  - happy path trims + lowercases email, calls login(), navigates to tasks
 *  - failed login shows the error message from describeApiError inline
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks: hoisted to the top so module imports inside LoginScreen see them.

const mockLogin = jest.fn();
jest.mock('@/lib/stores', () => ({
  useAuthStore: (selector: (s: { login: jest.Mock }) => unknown) =>
    selector({ login: mockLogin }),
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

jest.mock('@/lib/apiErrors', () => ({
  describeApiError: (_e: unknown, fallback: string) => fallback,
}));

import LoginScreen from '@/app/(auth)/login';

describe('<LoginScreen />', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
  });

  it('shows inline error and does not call login when fields are empty', () => {
    const { getByText, queryByText } = render(<LoginScreen />);
    fireEvent.press(getByText('Sign In'));
    expect(queryByText(/fill in all fields/i)).toBeTruthy();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('trims and lowercases email, calls login, navigates on success', async () => {
    mockLogin.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), '  User@Example.COM  ');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret');
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('user@example.com', 'secret');
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/tasks');
  });

  it('surfaces the login error through describeApiError inline', async () => {
    mockLogin.mockRejectedValue(new Error('nope'));
    const { getByPlaceholderText, getByText, findByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'pw');
    fireEvent.press(getByText('Sign In'));

    expect(await findByText(/check your credentials/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('navigates to /register when the register link is pressed', () => {
    const { getByText } = render(<LoginScreen />);
    fireEvent.press(getByText(/Register/i));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/register');
  });
});
