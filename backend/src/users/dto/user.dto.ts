import { Transform } from 'class-transformer'
import { IsEmail, IsEnum, IsString, Length } from 'class-validator'

export enum UserRoleDto {
  super_admin = 'super_admin',
  operational_admin = 'operational_admin',
}

export enum UserStatusDto {
  active = 'active',
  inactive = 'inactive',
}

export class CreateUserDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  firstName!: string

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  lastName!: string

  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @Length(3, 254)
  email!: string

  @IsEnum(UserRoleDto)
  role!: UserRoleDto
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatusDto)
  status!: UserStatusDto
}

export class UpdateUserRoleDto {
  @IsEnum(UserRoleDto)
  role!: UserRoleDto
}