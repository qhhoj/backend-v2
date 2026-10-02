import { CommandFactory } from 'nest-commander';
import { MigratorModule } from './migrator.module';

void CommandFactory.run(MigratorModule, ['log', 'warn', 'error']);
