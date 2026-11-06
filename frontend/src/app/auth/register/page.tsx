'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Public self-service registration is disabled; owner provisioning is handled by Master Admin. */
export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/auth/login');
  }, [router]);

  return null;
}
