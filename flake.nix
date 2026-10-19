{
  description = "CollisionLab coordinate preview renderer";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.python3 pkgs.jq ];
        # npm's workerd binary needs the Nix dynamic loader on NixOS.
        MINIFLARE_WORKERD_PATH = pkgs.writeShellScript "preview-workerd" ''
          exec ${pkgs.stdenv.cc.bintools.dynamicLinker} --library-path ${pkgs.glibc}/lib "$PWD/node_modules/@cloudflare/workerd-linux-64/bin/workerd" "$@"
        '';
      };
      formatter.${system} = pkgs.nixpkgs-fmt;
    };
}
