import {
  ExperienceMode,
  Gender,
  PilotStatus,
  UserType,
  VehicleStatus,
} from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding FLYT development database...');

  const roles = [
    { name: 'customer', description: 'Customer role' },
    { name: 'pilot', description: 'Pilot role' },
    { name: 'admin', description: 'Admin role' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      create: role,
      update: { description: role.description },
    });
  }

  const permissions = [
    'rides:read',
    'rides:write',
    'pilots:read',
    'pilots:write',
    'customers:read',
    'payments:read',
    'admin:dashboard',
  ];

  for (const code of permissions) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
  const allPermissions = await prisma.permission.findMany();
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id },
      },
      create: { roleId: adminRole.id, permissionId: permission.id },
      update: {},
    });
  }

  // Ledger accounts
  const accounts = [
    { code: 'CASH', name: 'Cash', type: 'ASSET' as const },
    { code: 'GATEWAY_CLEARING', name: 'Payment Gateway Clearing', type: 'ASSET' as const },
    { code: 'PILOT_PAYABLE', name: 'Pilot Payables', type: 'LIABILITY' as const },
    { code: 'COMMISSION_REVENUE', name: 'Commission Revenue', type: 'REVENUE' as const },
    { code: 'RIDE_REVENUE', name: 'Ride Revenue', type: 'REVENUE' as const },
    { code: 'GATEWAY_FEES', name: 'Gateway Fees', type: 'EXPENSE' as const },
    { code: 'REFUNDS', name: 'Refunds', type: 'EXPENSE' as const },
    { code: 'CUSTOMER_RECEIVABLE', name: 'Customer Receivables', type: 'ASSET' as const },
  ];
  for (const account of accounts) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      create: account,
      update: { name: account.name },
    });
  }

  // Vehicle / service categories
  const bike = await prisma.vehicleCategory.upsert({
    where: { code: 'BIKE' },
    create: {
      code: 'BIKE',
      name: 'Bike',
      description: 'Two-wheeler',
      capacity: 1,
      sortOrder: 1,
    },
    update: {},
  });

  const auto = await prisma.vehicleCategory.upsert({
    where: { code: 'AUTO' },
    create: {
      code: 'AUTO',
      name: 'Auto',
      description: 'Three-wheeler',
      capacity: 3,
      sortOrder: 2,
    },
    update: {},
  });

  const cab = await prisma.vehicleCategory.upsert({
    where: { code: 'CAB' },
    create: {
      code: 'CAB',
      name: 'Cab',
      description: 'Four-wheeler',
      capacity: 4,
      sortOrder: 3,
    },
    update: {},
  });

  const bikeService = await prisma.serviceCategory.upsert({
    where: { code: 'BIKE_STANDARD' },
    create: {
      code: 'BIKE_STANDARD',
      name: 'Bike',
      vehicleCategoryId: bike.id,
    },
    update: {},
  });

  await prisma.serviceCategory.upsert({
    where: { code: 'AUTO_STANDARD' },
    create: {
      code: 'AUTO_STANDARD',
      name: 'Auto',
      vehicleCategoryId: auto.id,
    },
    update: {},
  });

  await prisma.serviceCategory.upsert({
    where: { code: 'CAB_STANDARD' },
    create: {
      code: 'CAB_STANDARD',
      name: 'Cab',
      vehicleCategoryId: cab.id,
    },
    update: {},
  });

  const zone = await prisma.serviceZone.upsert({
    where: { code: 'BLR_CENTRAL' },
    create: {
      code: 'BLR_CENTRAL',
      name: 'Bengaluru Central',
      city: 'Bengaluru',
      boundaryGeoJson: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [77.55, 12.95],
            [77.65, 12.95],
            [77.65, 13.05],
            [77.55, 13.05],
            [77.55, 12.95],
          ],
        ],
      }),
    },
    update: {},
  });

  // Pricing — illustrative commission 20%
  const existingPricing = await prisma.pricingConfiguration.findFirst({
    where: { serviceCategoryId: bikeService.id, isActive: true },
  });

  if (!existingPricing) {
    await prisma.pricingConfiguration.create({
      data: {
        serviceCategoryId: bikeService.id,
        vehicleCategoryId: bike.id,
        zoneId: zone.id,
        baseFare: 25,
        perKmRate: 8,
        perMinuteRate: 1.5,
        waitingPerMinute: 1,
        minimumFare: 40,
        cancellationFee: 20,
        commissionPercent: 20,
      },
    });
  }

  await prisma.systemConfiguration.upsert({
    where: { key: 'silver_discount_percent' },
    create: {
      key: 'silver_discount_percent',
      value: 10,
      description: 'Approved Silver Mode discount percent',
    },
    update: { value: 10 },
  });

  await prisma.systemConfiguration.upsert({
    where: { key: 'matching_radius_meters' },
    create: {
      key: 'matching_radius_meters',
      value: 5000,
      description: 'Default matching radius',
    },
    update: {},
  });

  // Admin — password: Admin@Flyt2026!
  const adminPassword = await argon2.hash('Admin@Flyt2026!', { type: argon2.argon2id });
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'customer' } });
  const pilotRole = await prisma.role.findUniqueOrThrow({ where: { name: 'pilot' } });

  const adminUser = await prisma.user.upsert({
    where: { phone: '+919999000001' },
    create: {
      phone: '+919999000001',
      email: 'admin@flyt.local',
      passwordHash: adminPassword,
      userType: UserType.ADMIN,
      roles: { create: { roleId: adminRole.id } },
      admin: { create: { firstName: 'Flyt', lastName: 'Admin' } },
    },
    update: {
      passwordHash: adminPassword,
      email: 'admin@flyt.local',
    },
  });

  // Ensure admin role link
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    create: { userId: adminUser.id, roleId: adminRole.id },
    update: {},
  });

  // Customer (Standard)
  const customerUser = await prisma.user.upsert({
    where: { phone: '+919876543210' },
    create: {
      phone: '+919876543210',
      userType: UserType.CUSTOMER,
      roles: { create: { roleId: customerRole.id } },
      customer: {
        create: {
          firstName: 'Asha',
          lastName: 'Sharma',
          gender: Gender.FEMALE,
          experience: ExperienceMode.STANDARD,
          modeSetting: { create: { preferredMode: ExperienceMode.STANDARD } },
        },
      },
    },
    update: {},
    include: { customer: true },
  });

  // She + Silver eligible customer (female, 65, DOB verified)
  const silverDob = new Date(Date.UTC(1958, 0, 15));
  await prisma.user.upsert({
    where: { phone: '+919876543211' },
    create: {
      phone: '+919876543211',
      userType: UserType.CUSTOMER,
      roles: { create: { roleId: customerRole.id } },
      customer: {
        create: {
          firstName: 'Lakshmi',
          lastName: 'Iyer',
          gender: Gender.FEMALE,
          dateOfBirth: silverDob,
          dobVerified: true,
          experience: ExperienceMode.SHE,
          modeSetting: {
            create: {
              preferredMode: ExperienceMode.SHE,
              sheEnabled: true,
              silverEnabled: true,
            },
          },
        },
      },
    },
    update: {},
  });

  // Pilot
  const pilotUser = await prisma.user.upsert({
    where: { phone: '+919800011122' },
    create: {
      phone: '+919800011122',
      userType: UserType.PILOT,
      roles: { create: { roleId: pilotRole.id } },
      pilot: {
        create: {
          firstName: 'Ravi',
          lastName: 'Kumar',
          gender: Gender.MALE,
          status: PilotStatus.ACTIVE,
          sheEligible: false,
          city: 'Bengaluru',
          ratingAvg: 4.8,
          availability: { create: { status: 'OFFLINE' } },
          verification: { create: { status: 'APPROVED', verifiedAt: new Date() } },
          vehicles: {
            create: {
              categoryId: bike.id,
              make: 'Honda',
              model: 'Activa',
              color: 'Black',
              plateNumber: 'KA01AB1234',
              status: VehicleStatus.ACTIVE,
              isPrimary: true,
            },
          },
        },
      },
    },
    update: {},
    include: { pilot: true },
  });

  // She-eligible female pilot
  await prisma.user.upsert({
    where: { phone: '+919800011133' },
    create: {
      phone: '+919800011133',
      userType: UserType.PILOT,
      roles: { create: { roleId: pilotRole.id } },
      pilot: {
        create: {
          firstName: 'Priya',
          lastName: 'Nair',
          gender: Gender.FEMALE,
          status: PilotStatus.ACTIVE,
          sheEligible: true,
          city: 'Bengaluru',
          ratingAvg: 4.9,
          availability: { create: { status: 'OFFLINE' } },
          verification: { create: { status: 'APPROVED', verifiedAt: new Date() } },
          vehicles: {
            create: {
              categoryId: bike.id,
              make: 'TVS',
              model: 'Jupiter',
              color: 'Blue',
              plateNumber: 'KA02CD5678',
              status: VehicleStatus.ACTIVE,
              isPrimary: true,
            },
          },
        },
      },
    },
    update: {},
  });

  console.log('Seed complete.');
  console.log('--- Development accounts ---');
  console.log('Admin login:  admin@flyt.local / Admin@Flyt2026!');
  console.log('Customer OTP phone: +919876543210 (use POST /auth/send-otp)');
  console.log('She+Silver customer: +919876543211');
  console.log('Pilot OTP phone: +919800011122');
  console.log('She Pilot OTP phone: +919800011133');
  console.log(`Admin user id: ${adminUser.id}`);
  console.log(`Customer user id: ${customerUser.id}`);
  console.log(`Pilot user id: ${pilotUser.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
