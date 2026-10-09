import { CommandFactory } from 'nest-commander';
import { failCommand } from './cli-error';
import { MigratorModule } from './migrator.module';

void CommandFactory.run(MigratorModule, {
  logger: ['log', 'warn', 'error'],
  serviceErrorHandler: failCommand,
});
