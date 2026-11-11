import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { TableOccupancy, TableStatus } from '../../generated/prisma/enums'

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  number!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  capacity!: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  minCapacity?: number

  @IsString()
  @MaxLength(50)
  @IsOptional()
  sector?: string
}

export class UpdateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @IsOptional()
  number?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  capacity?: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  minCapacity?: number

  @IsString()
  @MaxLength(50)
  @IsOptional()
  sector?: string
}

export class UpdateTableStatusDto {
  @IsEnum(TableStatus)
  status!: TableStatus
}

export class UpdateTableServiceDto {
  @IsBoolean()
  isOutOfService!: boolean
}

export class UpdateTableOccupancyDto {
  @IsEnum(TableOccupancy)
  currentOccupancy!: TableOccupancy
}
