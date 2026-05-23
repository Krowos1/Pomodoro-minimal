package main

import "testing"

func TestValidateJSON(t *testing.T) {
	if err := validateJSON(`{"mode":"focus"}`); err != nil {
		t.Fatalf("expected valid JSON, got %v", err)
	}

	if err := validateJSON(`{bad json}`); err == nil {
		t.Fatal("expected invalid JSON to return an error")
	}
}
