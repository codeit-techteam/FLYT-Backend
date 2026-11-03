import { describe, expect, it } from 'vitest';
import { Gender } from '@prisma/client';
import { ModesService } from '../../src/modules/modes/modes.service';

describe('ModesService eligibility', () => {
  const service = new ModesService();

  it('allows She Mode only for female customers', () => {
    expect(service.isSheEligible({ gender: Gender.FEMALE })).toBe(true);
    expect(service.isSheEligible({ gender: Gender.MALE })).toBe(false);
    expect(service.isSheEligible({ gender: Gender.OTHER })).toBe(false);
  });

  it('requires verified DOB and age 60+ for Silver', () => {
    expect(
      service.isSilverEligible({
        dateOfBirth: new Date('1950-01-01'),
        dobVerified: true,
      }),
    ).toBe(true);

    expect(
      service.isSilverEligible({
        dateOfBirth: new Date('1950-01-01'),
        dobVerified: false,
      }),
    ).toBe(false);

    expect(
      service.isSilverEligible({
        dateOfBirth: new Date('2000-01-01'),
        dobVerified: true,
      }),
    ).toBe(false);
  });

  it('computes age correctly around birthdays', () => {
    const dob = new Date(Date.UTC(1960, 5, 15));
    const beforeBirthday = new Date(Date.UTC(2020, 5, 14));
    const onBirthday = new Date(Date.UTC(2020, 5, 15));
    expect(service.ageInYears(dob, beforeBirthday)).toBe(59);
    expect(service.ageInYears(dob, onBirthday)).toBe(60);
  });
});
