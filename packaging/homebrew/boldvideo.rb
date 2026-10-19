class Boldvideo < Formula
  desc "Run your Bold video library from a shell"
  homepage "https://boldvideo.com"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-darwin-arm64"
      sha256 "72bfd09e57edc1b54ca85495bf286d2e12548afc778e33970f9990bcee487683"
    end
    on_intel do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-darwin-x64"
      sha256 "e12555aa290f253ce6b513db752368c2dc82432b1bf99ec6073ae9d684ddae93"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-linux-arm64"
      sha256 "a15ade146d7834f92f2c7478899feb44431fed538b0f2e43e0ee651dc0dcdada"
    end
    on_intel do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-linux-x64"
      sha256 "f70e52c38529b2c12f4660f43c0e2812ed735df60328406e6754fc7963f7ffb9"
    end
  end

  def install
    bin.install Dir["boldvideo-*"].first => "boldvideo"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boldvideo --version")
  end
end
