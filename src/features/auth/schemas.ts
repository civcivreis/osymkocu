import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta gir'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
});

export const registerSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, 'İsim en az 2 karakter olmalı')
      .max(40, 'İsim çok uzun'),
    email: z.string().trim().email('Geçerli bir e-posta gir'),
    password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
    confirmPassword: z.string().min(8, 'Şifreyi tekrar gir'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Şifreler eşleşmiyor',
    path: ['confirmPassword'],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
