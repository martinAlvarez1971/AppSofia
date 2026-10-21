import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import type { UserRequest } from './auth.types'

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<UserRequest>()
  if (!request.user) throw new UnauthorizedException()
  return request.user
})