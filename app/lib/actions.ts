'use server';

import { sql } from '@vercel/postgres';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { BaseRequestState, NewsletterState } from './utils';
import { send_email, send_new_lead_email } from '../services/email-service';

const prisma = new PrismaClient();

const FormSchema = z.object({
  id: z.string(),
  customerId: z.string({
    invalid_type_error: 'Please select a customer.',
  }),
  amount: z.coerce
    .number()
    .gt(0, { message: 'Please enter an amount greater than $0.' }),
  status: z.enum(['pending', 'paid'], {
    invalid_type_error: 'Please select an invoice status.',
  }),
  date: z.string(),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });

export async function createInvoice(prevState: State, formData: FormData) {
  // Validate form fields using Zod
  const validatedFields = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    console.log(validatedFields.error.flatten().fieldErrors);
    console.log('------------------------------------------------');
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }
  const { customerId, amount, status } = CreateInvoice.parse(
    validatedFields.data,
  );
  const amountInCents = amount * 100;
  const dateStr = new Date().toISOString();

  try {
    await sql`
    INSERT INTO invoices (customer_id, amount, status, date)
    VALUES (${customerId}, ${amountInCents}, ${status}, ${dateStr})
  `;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

// Use Zod to update the expected types
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

// ...

export async function updateInvoice(
  id: string,
  prevState: State,
  formData: FormData,
) {
  const validatedFields = UpdateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    };
  }
  const { customerId, amount, status } = validatedFields.data;

  const amountInCents = amount * 100;

  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
  try {
    await sql`DELETE FROM invoices WHERE id = ${id}`;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  revalidatePath('/dashboard/invoices');
  return { message: 'Deleted Invoice.' };
}

export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

export async function authenticate(
  prevState: any | undefined,
  formData: FormData,
) {
  console.log('calling authenticate');
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}

export async function closeSession() {
  try {
    await signOut();
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'SignOutError':
          return 'Error signing out.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  password: z.string(),
});

const CreateUser = UserSchema.omit({ id: true });

export async function createUser(
  prevState: BaseRequestState,
  formData: FormData,
) {
  // Validate form fields using Zod
  const validatedFields = CreateUser.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    console.log(validatedFields.error.flatten().fieldErrors);
    console.log('------------------------------------------------');
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create User.',
    };
  }
  const { name, email, password } = CreateUser.parse(validatedFields.data);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { name, email, password: passwordHash },
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  revalidatePath('/newsletters');
  redirect('/newsletters');
}

const LeadSchema = z.object({
  id: z.string(),
  email: z.string(),
  source: z.string(),
});

const CreateLead = LeadSchema.omit({ id: true, source: true });

export async function createLead(
  prevState: BaseRequestState,
  formData: FormData,
) {
  // Validate form fields using Zod
  const validatedFields = CreateLead.safeParse({
    email: formData.get('email'),
  });
  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    return {
      error: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Lead.',
    };
  }
  const { email } = CreateLead.parse(validatedFields.data);

  try {
    await prisma.lead.create({
      data: {
        email,
        source: 'web',
      },
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  send_new_lead_email(email);
  redirect('/');
}

const NewsletterSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  name: z.string().min(3),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  ownerId: z.string(),
});

const CreateNewsletter = NewsletterSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export async function createNewsletter(
  prevState: NewsletterState,
  formData: FormData,
): Promise<NewsletterState> {
  console.log('formData', formData);
  // Validate form fields using Zod
  const validatedFields = CreateNewsletter.safeParse({
    name: formData.get('name'),
    ownerId: formData.get('ownerId'),
    frequency: formData.get('frequency'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    await prisma.newsletter.create({
      data: CreateNewsletter.parse(validatedFields.data),
    });
  } catch (error) {
    return {
      generalError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  revalidatePath('/newsletters');
  redirect('/newsletters');
}

export async function updateNewsletter(
  prevState: NewsletterState,
  id: string,
  formData: FormData,
): Promise<NewsletterState> {
  console.log('formData', formData);
  // Validate form fields using Zod
  const validatedFields = CreateNewsletter.safeParse({
    name: formData.get('name'),
    ownerId: formData.get('ownerId'),
    frequency: formData.get('frequency'),
  });
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    await prisma.newsletter.update({
      where: { id },
      data: CreateNewsletter.parse(validatedFields.data),
    });
  } catch (error) {
    return {
      generalError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  revalidatePath('/newsletters');
  redirect('/newsletters');
}

export async function getNewsletters() {
  try {
    return await prisma.newsletter.findMany();
  } catch (error) {
    console.error('Failed to fetch newsletters:', error);
    throw new Error('Failed to fetch newsletters.');
  }
}

export async function getNewsletterById(id: string) {
  try {
    return await prisma.newsletter.findUnique({ where: { id } });
  } catch (error) {
    console.error('Failed to fetch newsletter:', error);
    throw new Error('Failed to fetch newsletters.');
  }
}
