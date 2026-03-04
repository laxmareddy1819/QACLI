export class Autocomplete {
  private commands: string[] = [];

  setCommands(commands: string[]): void {
    this.commands = commands.map((c) => `/${c}`);
  }

  complete(line: string): [string[], string] {
    if (!line.startsWith('/')) {
      return [[], line];
    }

    const matches = this.commands.filter((c) =>
      c.startsWith(line.toLowerCase()),
    );

    return [matches, line];
  }
}
