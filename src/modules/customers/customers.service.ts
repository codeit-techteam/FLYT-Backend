import { ExperienceMode, Gender } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { modesService } from '../modes/modes.service';

export class CustomersService {
  async getMe(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        user: { select: { phone: true, email: true, status: true } },
        modeSetting: true,
        modeEligibilities: true,
        emergencyContacts: true,
      },
    });
    if (!customer) throw AppError.notFound('Customer not found');

    const sheEligible = modesService.isSheEligible(customer);
    const silverEligible = modesService.isSilverEligible(customer);

    return {
      ...customer,
      eligibility: {
        she: sheEligible,
        silver: silverEligible,
        combined: sheEligible && silverEligible,
      },
    };
  }

  async updateMe(
    customerId: string,
    input: {
      firstName?: string;
      lastName?: string;
      gender?: Gender;
      dateOfBirth?: string;
      experience?: ExperienceMode;
      preferredMode?: ExperienceMode;
    },
  ) {
    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.experience !== undefined) data.experience = input.experience;

    if (input.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(input.dateOfBirth);
      // DOB verification is an admin/ops process — do not auto-verify from client
    }

    const customer = await prisma.customer.update({
      where: { id: customerId },
      data,
      include: { modeSetting: true },
    });

    if (input.preferredMode) {
      await prisma.customerModeSetting.upsert({
        where: { customerId },
        create: { customerId, preferredMode: input.preferredMode },
        update: { preferredMode: input.preferredMode },
      });
    }

    return this.getMe(customer.id);
  }

  async listEmergencyContacts(customerId: string) {
    return prisma.emergencyContact.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async addEmergencyContact(
    customerId: string,
    input: { name: string; phone: string; relation?: string; isPrimary?: boolean },
  ) {
    const count = await prisma.emergencyContact.count({ where: { customerId } });
    if (count >= 5) {
      throw AppError.badRequest('Maximum 5 emergency contacts allowed');
    }

    if (input.isPrimary) {
      await prisma.emergencyContact.updateMany({
        where: { customerId },
        data: { isPrimary: false },
      });
    }

    return prisma.emergencyContact.create({
      data: {
        customerId,
        name: input.name,
        phone: input.phone,
        relation: input.relation,
        isPrimary: input.isPrimary ?? count === 0,
      },
    });
  }
}

export const customersService = new CustomersService();
