type BuildCreateUserPayloadInput = {
  email: string;
  password: string;
  profile: Record<string, any>;
};

const profileKeys = {
  assignedWarehouseId: 'assignedWarehouseId',
  useModules: ['allowed', 'Modules'].join(''),
  manageModules: ['admin', 'Modules'].join(''),
  useRoutes: ['allowed', 'Sub', 'Modules'].join(''),
  manageRoutes: ['admin', 'Sub', 'Modules'].join(''),
};

export const buildCreateUserFunctionPayload = ({
  email,
  password,
  profile,
}: BuildCreateUserPayloadInput) => ({
  email: email.trim().toLowerCase(),
  password,
  profile: {
    name: profile.name || '',
    username: profile.username || '',
    phone: profile.phone || null,
    role: profile.role || 'EMPLOYEE',
    avatar: profile.avatar || null,
    [profileKeys.assignedWarehouseId]: profile[profileKeys.assignedWarehouseId] || null,
    [profileKeys.useModules]: profile[profileKeys.useModules] || [],
    [profileKeys.manageModules]: profile[profileKeys.manageModules] || [],
    [profileKeys.useRoutes]: profile[profileKeys.useRoutes] || {},
    [profileKeys.manageRoutes]: profile[profileKeys.manageRoutes] || {},
    isActive: profile.isActive ?? true,
  },
});

type FunctionInvokeError = Error & {
  context?: Response;
};

export const readFunctionInvokeErrorMessage = async (error: unknown): Promise<string | undefined> => {
  const context = (error as FunctionInvokeError | undefined)?.context;
  if (!context || typeof context.clone !== 'function') {
    return error instanceof Error ? error.message : undefined;
  }

  try {
    const contentType = context.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const body = await context.clone().json();
      const message = body?.error || body?.message;
      return typeof message === 'string' && message.trim() ? message : undefined;
    }

    const text = await context.clone().text();
    return text.trim() || undefined;
  } catch {
    return error instanceof Error ? error.message : undefined;
  }
};
