import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupDatabase } from './database';
import { AuthModule } from './auth.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { swaggerAppConfig } from './swagger-app.config';
import { swaggerAuthConfig } from './swagger-auth.config';

async function bootstrap() {
  
  
  await setupDatabase();

  const ServerErrorTypes = {
    400: { type: "https://pix.bcb.gov.br/api/v2/error/CobOperacaoInvalida", title: "Payload inválido" },
    403: { type: "https://pix.bcb.gov.br/api/v2/error/AcessoNegado", title: "Acesso Negado" },
    404: { type: "https://pix.bcb.gov.br/api/v2/error/NaoEncontrado", title: "Não Encontrado" },
    503: { type: "https://pix.bcb.gov.br/api/v2/error/ServicoIndisponivel", title: "Serviço não está disponível no momento. Serviço solicitado pode estar em manutenção ou fora da janela de funcionamento." },
}


  
  //SERVIÇO PRINCIPAL  
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  
  const appDocument = SwaggerModule.createDocument(app, swaggerAppConfig);
  SwaggerModule.setup('api-docs', app, appDocument);
  
  await app.listen(3000);

  //SERVIÇO DE AUTENTICAÇÃO
  const auth = await NestFactory.create(AuthModule);
  
  const authDocument = SwaggerModule.createDocument(auth, swaggerAuthConfig);
  SwaggerModule.setup('api-docs', auth, authDocument);
  
  await auth.listen(3001);
}
bootstrap();
