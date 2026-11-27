//go:build !js

package main

// Native builds (handy for `go run .` while iterating) have no host page.
func hostMenu()          {}
func loadBest() int      { return 0 }
func saveBest(int)       {}
func installDebug(*Game) {}
